/**
 * A multisig private action is compiled once and proved as compiled. The
 * privacy SDK draws new random values on every compile, so the CallSet digest
 * co-owners sign exists only for the compile that produced it. The first live
 * mainnet round failed here: the second prepare compiled again and no
 * co-owner's signature ever matched. These run that flow against a fake SDK
 * that draws a new value on every compile.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { num } from "starknet";
import {
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

const owners = async (options: { readonly tamper?: boolean } = {}) => {
  const sdk = randomizedStrk20Sdk(options);
  const cosigner = await makeStrk20Cosigner({ strk20: sdk.service });
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
  return { as, call, register, sdk, store };
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
