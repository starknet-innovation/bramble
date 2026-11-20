/**
 * A multisig private action is compiled once and proved as compiled. The
 * privacy SDK draws new random values on every compile, so the CallSet digest
 * co-owners sign exists only for the compile that produced it. The first live
 * mainnet round failed here: the second prepare compiled again and no
 * co-owner's signature ever matched. These run that flow against a fake SDK
 * that draws a new value on every compile.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { argentMultisigOperationId } from "@bramble/multisig/repository";
import { STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import { createMultisigStrk20Store } from "@bramble/privacy/multisig-strk20-store";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { createMemoryStore } from "@bramble/store/kv";
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { ec, num } from "starknet";
import {
  findResumableStrk20Request,
  isRelayPlanLive,
} from "../../../apps/extension/src/background/multisig/multisig-strk20-held";
import {
  callSetAuthorization,
  setViewingKey,
} from "../../../packages/features/privacy/tests/support/multisig-callset";
import {
  HARNESS_MULTISIG,
  HARNESS_MULTISIG_ID,
  harnessAccountA,
  harnessAccountB,
  harnessExtensionSender,
} from "../../support/multisig-harness";
import { makeStrk20Cosigner } from "../../support/multisig-strk20-cosigner";
import {
  COMPILED_BLOCK,
  HARNESS_SCALAR,
  randomizedStrk20Sdk,
  sdkExecuteCalldata,
} from "../../support/multisig-strk20-sdk";

const VALIDITY_BLOCKS = 100;
let currentBlock = COMPILED_BLOCK + 20;
const realFetch = globalThis.fetch;

// The pool's proof window, read over JSON-RPC: the latest block and
// `get_proof_validity_blocks`. Nothing else may reach the network.
const chainFetch = (async (_input: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as { id?: unknown; method?: string };
  const results: Record<string, unknown> = {
    starknet_blockNumber: currentBlock,
    starknet_call: [num.toHex(VALIDITY_BLOCKS)],
    starknet_specVersion: "0.10.0",
  };
  if (!body.method || !(body.method in results)) {
    throw new Error(`unexpected RPC ${body.method ?? "request"}`);
  }
  return new Response(
    JSON.stringify({ id: body.id, jsonrpc: "2.0", result: results[body.method] }),
    {
      headers: { "content-type": "application/json" },
    },
  );
}) as typeof fetch;

beforeEach(() => {
  currentBlock = COMPILED_BLOCK + 20;
  globalThis.fetch = chainFetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const owners = async (options: { readonly onChain?: boolean; readonly tamper?: boolean } = {}) => {
  const sdk = randomizedStrk20Sdk(options);
  const cosigner = await makeStrk20Cosigner({
    strk20: sdk.service,
    // The chain reports every hash as landed, for the recovery path.
    ...(options.onChain
      ? {
          getTransactionStatuses: async (hash: string) => ({
            [hash]: { finalizedOnL1: false, found: true, status: "pending" as const },
          }),
        }
      : {}),
  });
  const store = cosigner.owner.strk20MultisigStore;
  // A co-owner holds the key, so registration is not refused as the only copy.
  await store.markKeyShared(HARNESS_MULTISIG_ID, true);
  const call = (message: Record<string, unknown>) =>
    cosigner.owner.handler(message, harnessExtensionSender) as Promise<Record<string, unknown>>;
  const as = (accountId: string) => call({ accountId, type: "wallet.setActiveAccount" });
  const register = () =>
    call({
      kind: "register",
      multisigId: HARNESS_MULTISIG_ID,
      type: "wallet.prepareArgentMultisigStrk20",
    });
  // Registers through both rounds and returns the frozen, fully signed intent.
  const signedRegistration = async (): Promise<string> => {
    const first = await register();
    await as(harnessAccountA.id);
    await call({ id: first["id"], type: "wallet.signArgentMultisigStrk20Authorization" });
    await as(harnessAccountB.id);
    const intentId = ((await register())["intent"] as { readonly id: string }).id;
    for (const signerAccountId of [harnessAccountA.id, harnessAccountB.id]) {
      await call({ intentId, signerAccountId, type: "wallet.signArgentMultisigIntent" });
    }
    return intentId;
  };
  return {
    as,
    call,
    multisigStore: cosigner.owner.multisigStore,
    register,
    sdk,
    signedRegistration,
    store,
  };
};

describe("a multisig private action is proved as compiled", () => {
  test("co-owners sign one compile, and that compile is the one proved", async () => {
    const { as, call, register, sdk, store } = await owners();
    const first = await register();
    expect(first).toMatchObject({ ok: true, phase: "authorization" });
    expect(sdk.log.compiled).toHaveLength(1);
    expect(sdk.log.proved).toHaveLength(0);

    // The kept request holds no calldata, no signature, and not the scalar.
    const [held] = await store.listHeld(HARNESS_MULTISIG_ID);
    expect(held?.id).toBe(first["id"] as string);
    expect(Object.keys(held?.envelope ?? {})).not.toContain("calldata");
    expect(Object.keys(held?.envelope ?? {})).not.toContain("signature");
    expect(JSON.stringify(held)).not.toContain(HARNESS_SCALAR.slice(2));

    // The other owner signs the same digest.
    await as(harnessAccountA.id);
    await expect(
      call({ id: first["id"], type: "wallet.signArgentMultisigStrk20Authorization" }),
    ).resolves.toMatchObject({ ok: true, phase: "fresh" });

    // Preparing again proves the first compile; nothing is compiled again.
    await as(harnessAccountB.id);
    const second = await register();
    expect(second).toMatchObject({ ok: true });
    expect(second["intent"]).toBeDefined();
    expect(sdk.log.compiled).toHaveLength(1);
    expect(sdk.log.proved).toHaveLength(1);
    const proved = sdk.log.proved[0]?.invocation;
    const compiledCall = sdk.log.compiled[0];
    expect(compiledCall).toBeDefined();
    expect(proved?.["calldata"]).toEqual([
      ...sdkExecuteCalldata(compiledCall ?? { contractAddress: "0x0", entrypoint: "x" }),
    ]);
    // The 2-of-2 aggregate: a count, then each signer's type tag (0x0, a
    // Stark key), public key, r, and s. Not the unsigned placeholder.
    expect(proved?.["signature"]).toHaveLength(1 + 2 * 4);
    expect(proved?.["signature"]).not.toEqual(["0x0"]);
    const signature = (proved?.["signature"] ?? []) as readonly string[];
    expect(signature[0]).toBe("0x2");
    // The prover reads every felt as 0x hex, as the SDK's own formatSignature
    // writes them; the aggregate's leading count is not hex until converted.
    expect(signature.every((felt) => /^0x[0-9a-f]+$/.test(felt))).toBe(true);
    // Proved and frozen, so it is not held any more.
    expect(await store.listHeld(HARNESS_MULTISIG_ID)).toEqual([]);

    // Both owners sign the registration and it is sent. The write goes into
    // the multisig's maturity journal, so the next proof is built past it.
    const intentId = (second["intent"] as { readonly id: string }).id;
    for (const signerAccountId of [harnessAccountA.id, harnessAccountB.id]) {
      await expect(
        call({ intentId, signerAccountId, type: "wallet.signArgentMultisigIntent" }),
      ).resolves.toMatchObject({ ok: true });
    }
    const sent = await call({ intentId, type: "wallet.submitArgentMultisigIntent" });
    expect(sent).toMatchObject({ ok: true });
    expect(sdk.log.recorded).toEqual([
      { accountId: HARNESS_MULTISIG_ID, transactionHash: sent["transactionHash"] as string },
    ]);
  });

  test("a registration found on chain by recovery is journaled too", async () => {
    const { call, multisigStore, sdk, signedRegistration } = await owners({ onChain: true });
    const intentId = await signedRegistration();
    const intent = await multisigStore.getIntent(intentId);
    const hash = intent?.prepared.transactionHash ?? "";
    // An earlier send left its claim, so this submit resolves from the chain.
    const operationId = argentMultisigOperationId("submit", HARNESS_MULTISIG_ID, hash);
    if (!operationId) throw new Error("submission operation id unavailable");
    await multisigStore.claimOperation({
      accountId: HARNESS_MULTISIG_ID,
      id: operationId,
      kind: "submit",
      target: hash,
    });
    await expect(
      call({ intentId, type: "wallet.submitArgentMultisigIntent" }),
    ).resolves.toMatchObject({ ok: true, transactionHash: hash });
    expect(sdk.log.recorded).toEqual([{ accountId: HARNESS_MULTISIG_ID, transactionHash: hash }]);
  });

  test("a co-owner's landed registration is journaled before this wallet's next proof", async () => {
    const { multisigStore, register, sdk, signedRegistration } = await owners({ onChain: true });
    const intentId = await signedRegistration();
    const hash = (await multisigStore.getIntent(intentId))?.prepared.transactionHash ?? "";
    expect(sdk.log.recorded).toEqual([]);
    // This wallet signed but never sent it; the chain says it landed.
    await register();
    expect(sdk.log.recorded).toEqual([{ accountId: HARNESS_MULTISIG_ID, transactionHash: hash }]);
    expect((await multisigStore.getIntent(intentId))?.state).toBe("submitted");
    // Marked submitted, it is not journaled again over a newer write.
    await register();
    expect(sdk.log.recorded).toHaveLength(1);
  });

  test("a compile whose calldata is not the signed call is refused and not held", async () => {
    const { register, sdk, store } = await owners({ tamper: true });
    await expect(register()).resolves.toEqual({ error: "Invalid Argent multisig private proof" });
    expect(sdk.log.proved).toHaveLength(0);
    expect(await store.listHeld(HARNESS_MULTISIG_ID)).toEqual([]);
  });

  test("a held request past the pool's proof window is dropped and compiled again", async () => {
    const { as, call, register, sdk, store } = await owners();
    const first = await register();
    await as(harnessAccountA.id);
    await call({ id: first["id"], type: "wallet.signArgentMultisigStrk20Authorization" });
    await as(harnessAccountB.id);
    currentBlock = COMPILED_BLOCK + VALIDITY_BLOCKS + 1;
    const second = await register();
    // A new compile, a new digest, and a new round of signatures.
    expect(second).toMatchObject({ ok: true, phase: "authorization" });
    expect(second["id"]).not.toBe(first["id"]);
    expect(sdk.log.compiled).toHaveLength(2);
    expect(sdk.log.proved).toHaveLength(0);
    expect((await store.listHeld(HARNESS_MULTISIG_ID)).map((row) => row.id)).toEqual([
      second["id"] as string,
    ]);
  });
});

describe("a held relay's fee authorization", () => {
  const NOW = 1_800_000_000;
  const plan = (executeBefore: number | string) => ({
    authorization: {
      caller: "0x1",
      executeAfter: "0x0",
      executeBefore: typeof executeBefore === "number" ? num.toHex(executeBefore) : executeBefore,
      publicCallCount: 0,
    },
    feeAction: { amount: "0x1", recipient: "0x2", token: "0x3", type: "withdraw" },
  });

  test("is live only with more than two minutes left", () => {
    expect(isRelayPlanLive(plan(NOW + 121), NOW)).toBe(true);
    expect(isRelayPlanLive(plan(NOW + 120), NOW)).toBe(false);
    expect(isRelayPlanLive(plan(NOW - 1), NOW)).toBe(false);
    expect(isRelayPlanLive(plan("not a felt"), NOW)).toBe(false);
    // A plan with no authorization window has no deadline.
    expect(isRelayPlanLive({ feeAction: plan(0).feeAction }, NOW)).toBe(true);
  });

  test("a held relay past its authorization is dropped instead of proved", async () => {
    const store = createMultisigStrk20Store(createMemoryStore());
    const id = `${HARNESS_MULTISIG_ID}:0x${"a".repeat(63)}`;
    await store.putHeld({
      accountId: HARNESS_MULTISIG_ID,
      envelope: { nonce: "0x0" },
      id,
      plan: plan(NOW - 1),
      provingBlock: COMPILED_BLOCK,
    });
    const resumed = await findResumableStrk20Request({
      accountId: HARNESS_MULTISIG_ID,
      action: { amount: "0x1", kind: "transfer", recipient: "0x2", token: "0x3" },
      nowSeconds: NOW,
      readWindow: async () => ({ currentBlock: BigInt(COMPILED_BLOCK + 1), validityBlocks: 100n }),
      scalar: HARNESS_SCALAR,
      signers: { signerPublicKeys: [], threshold: 2 },
      store,
    });
    expect(resumed).toBeNull();
    expect(await store.listHeld(HARNESS_MULTISIG_ID)).toEqual([]);
  });
});

describe("a held request after the signer set changes", () => {
  test("resumes under the set it was signed for, and is dropped under another", async () => {
    const [a, b] = ["0x11", "0x22"]
      .map((privateKey) => ({ privateKey, publicKey: ec.starkCurve.getStarkKey(privateKey) }))
      .sort((left, right) =>
        BigInt(argentSignerGuid(left.publicKey)) < BigInt(argentSignerGuid(right.publicKey))
          ? -1
          : 1,
      ) as [{ privateKey: string; publicKey: string }, { privateKey: string; publicKey: string }];
    const signerPublicKeys = [a.publicKey, b.publicKey];
    const authorization = callSetAuthorization({
      accountAddress: HARNESS_MULTISIG,
      accountId: HARNESS_MULTISIG_ID,
      actions: [setViewingKey()],
      chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
      pool: canonicalFelt(STRK20_MAINNET_POOL) ?? "0x1",
      scalar: HARNESS_SCALAR,
      signerPublicKeys,
      signWith: [a, b],
      threshold: 2,
    });
    const store = createMultisigStrk20Store(createMemoryStore());
    expect(await store.upsertAuthorization(authorization, HARNESS_SCALAR)).toBe("stored");
    await store.putHeld({
      accountId: HARNESS_MULTISIG_ID,
      envelope: { nonce: "0x0" },
      id: authorization.id,
      provingBlock: COMPILED_BLOCK,
    });
    const resume = (signers: { signerPublicKeys: readonly string[]; threshold: number }) =>
      findResumableStrk20Request({
        accountId: HARNESS_MULTISIG_ID,
        action: { kind: "register" },
        nowSeconds: 1_800_000_000,
        readWindow: async () => ({
          currentBlock: BigInt(COMPILED_BLOCK + 1),
          validityBlocks: 100n,
        }),
        scalar: HARNESS_SCALAR,
        signers,
        store,
      });
    expect(await resume({ signerPublicKeys, threshold: 2 })).not.toBeNull();
    // A signer was added since: the old aggregate is for a set that is gone.
    const grown = [...signerPublicKeys, ec.starkCurve.getStarkKey("0x33")];
    expect(await resume({ signerPublicKeys: grown, threshold: 2 })).toBeNull();
    expect(await store.listHeld(HARNESS_MULTISIG_ID)).toEqual([]);
  });
});
