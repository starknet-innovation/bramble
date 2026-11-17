/**
 * Round handling for multisig STRK20 actions (PR 827 items 3, 4, 6, M1, M3,
 * L2, L3): a waiting CallSet reports its id, a CallSet that arrives before the
 * key is retried, a stranger cannot pin the sync window, a sent relay is never
 * repeated, register and deposit wait for a second key holder, and removing a
 * multisig keeps an unsent relay and then leaves no plaintext rows behind.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import { computeStrk20CallSetHash } from "@bramble/privacy/call-set-signer";
import { STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import type { MultisigStrk20RelayRequest } from "@bramble/privacy/multisig-strk20";
import type { Strk20Service } from "@bramble/privacy/service";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { MULTISIG_STRK20_KEY_IDENTIFIER } from "@bramble/vault/multisig-strk20-key";
import {
  canonicalFelt,
  STARKNET_NETWORKS,
  STRK_TOKEN_ADDRESS,
} from "@bramble/wallet-model/networks";
import { type Call, num } from "starknet";
import { coordinationRelayUrls } from "../../../apps/extension/src/background/multisig/multisig-coordination-ops";
import type { MultisigOpsDeps } from "../../../apps/extension/src/background/multisig/multisig-deps";
import { proveMultisigStrk20 } from "../../../apps/extension/src/background/multisig/multisig-strk20-prove";
import {
  MULTISIG_STRK20_SHARE_FIRST,
  MULTISIG_STRK20_WAITING,
  type MultisigStrk20Session,
} from "../../../apps/extension/src/background/multisig/multisig-strk20-session";
import {
  callSetAuthorization,
  compileActionsCalldata,
  deposit,
  invokeExternal,
  setViewingKey,
} from "../../../packages/features/privacy/tests/support/multisig-callset";
import {
  HARNESS_KEYS,
  HARNESS_MULTISIG,
  HARNESS_MULTISIG_ID,
  HARNESS_TARGET,
  harnessAccountA,
  harnessAccountB,
  harnessExtensionSender,
} from "../../support/multisig-harness";
import {
  COSIGNER_NOW_MS,
  createKey,
  makeStrk20Cosigner,
  STRANGER_NOSTR,
} from "../../support/multisig-strk20-cosigner";

const SCALAR = "0x654321";
const POOL = canonicalFelt(STRK20_MAINNET_POOL) ?? "0x1";
const STRK = canonicalFelt(STRK_TOKEN_ADDRESS) ?? "0x1";
const NOW = COSIGNER_NOW_MS / 1000;

const callSet = (accountId = HARNESS_MULTISIG_ID) =>
  callSetAuthorization({
    accountAddress: HARNESS_MULTISIG,
    accountId,
    actions: [deposit(STRK, 10n ** 18n)],
    chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
    pool: POOL,
    scalar: SCALAR,
    signerPublicKeys: HARNESS_KEYS,
    threshold: 2,
  });

const relay = (state: MultisigStrk20RelayRequest["state"]): MultisigStrk20RelayRequest => ({
  accountAddress: HARNESS_MULTISIG,
  accountId: HARNESS_MULTISIG_ID,
  call: { calldata: ["0x1"], contractAddress: POOL, entrypoint: "apply_actions" },
  feeAction: { amount: "0x5", recipient: "0x4", token: STRK, type: "withdraw" },
  fragments: [],
  id: `${HARNESS_MULTISIG_ID}:0x9`,
  proof: {
    data: "aa",
    output: ["0x1"],
    proof_facts: ["0x1", "0x2", "0x3", "0x4", "0x5", "0x6", "0x7", "0x1", "0x9"],
  },
  request: { amount: "0x10", kind: "transfer", recipient: "0x6", token: STRK },
  signerPublicKeys: HARNESS_KEYS,
  state,
  summary: "Transfer from this multisig's private balance",
  threshold: 2,
});

describe("waiting for co-owners (item 3)", () => {
  test("an asynchronous waiting refusal returns the authorization id", async () => {
    const service = {
      async poolFee() {
        return "0x1";
      },
      async prepareRegistration(input: { readonly signCallSet?: () => Promise<unknown> }) {
        await input.signCallSet?.();
        throw new Error("unreachable");
      },
    } as unknown as Strk20Service;
    const session = {
      context: { rpcUrls: [] },
      isAuthorized: () => true,
      prepareRequest: () => undefined,
      privacyAccount: { address: HARNESS_MULTISIG, id: HARNESS_MULTISIG_ID, networkId: "SN_MAIN" },
      privacyConfig: { poolAddress: POOL },
      signCallSet: async () => {
        await Promise.resolve();
        throw new WalletError(MULTISIG_STRK20_WAITING);
      },
      strk20: service,
      waitingId: () => `${HARNESS_MULTISIG_ID}:0xabc`,
    } as unknown as MultisigStrk20Session;
    await expect(
      proveMultisigStrk20({} as MultisigOpsDeps, session, { kind: "register" }, async () => SCALAR),
    ).resolves.toEqual({ id: `${HARNESS_MULTISIG_ID}:0xabc`, ok: true, phase: "authorization" });
  });
});

describe("CallSet and viewing-key ordering (item 4)", () => {
  test("a CallSet that arrives before the key is retried, then stored", async () => {
    const { owner, send, sync } = await makeStrk20Cosigner({ withKey: false });
    const round = callSet();
    await send({ authorization: round, kind: "call-set", version: 1 });
    // A package for another chain needs no key to refuse, so it is final now.
    const foreign = { ...round, chainId: STARKNET_NETWORKS.SN_SEPOLIA.chainId };
    await send({ authorization: foreign, kind: "call-set", version: 1 });
    await expect(sync()).resolves.toMatchObject({ ok: true, received: 1 });
    await createKey(owner);
    await expect(sync()).resolves.toMatchObject({ ok: true, received: 1 });
    expect(await owner.strk20MultisigStore.getAuthorization(round.id, SCALAR)).not.toBeNull();
  });
});

describe("wraps that can never become valid (M1)", () => {
  test("a stranger's key, another multisig's CallSet, and a bad CallSet do not pin the window", async () => {
    const { checkpoints, send, sync } = await makeStrk20Cosigner();
    const keyPackage = JSON.stringify({
      chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
      multisigId: HARNESS_MULTISIG_ID,
      poolAddress: POOL,
      version: 1,
      viewingKey: "0x222",
    });
    await send(keyPackage, STRANGER_NOSTR, MULTISIG_STRK20_KEY_IDENTIFIER);
    await send({ authorization: callSet(), kind: "call-set", version: 1 }, STRANGER_NOSTR);
    await send({ authorization: callSet("SN_MAIN:0x777"), kind: "call-set", version: 1 });
    await send({ authorization: { ...callSet(), hash: "0x1" }, kind: "call-set", version: 1 });
    await expect(sync()).resolves.toMatchObject({ ok: true, received: 4 });
    const checkpoint = await checkpoints.getCheckpoint(
      HARNESS_MULTISIG_ID,
      coordinationRelayUrls(defaultWalletPreferences()),
    );
    expect(checkpoint?.syncedAt).toBe(NOW);
  });
});

describe("a relay that was sent (item 6, L2)", () => {
  test("is neither refreshed nor sent again", async () => {
    let broadcasts = 0;
    const strk20 = {
      async poolFee() {
        return "0x1";
      },
      async prepare() {
        throw new Error("unused");
      },
      async submitAcceptedRelay() {
        broadcasts += 1;
        return { transactionHash: "0x1" };
      },
    } as unknown as Strk20Service;
    const { owner } = await makeStrk20Cosigner({ strk20 });
    const sent = relay("submitted");
    expect(await owner.strk20MultisigStore.upsertRelay(sent)).toBe("stored");
    for (const type of [
      "wallet.refreshArgentMultisigStrk20",
      "wallet.submitArgentMultisigStrk20Relay",
    ]) {
      await expect(owner.handler({ id: sent.id, type }, harnessExtensionSender)).resolves.toEqual({
        error: "Argent multisig intent was already sent",
      });
    }
    expect(broadcasts).toBe(0);
  });
});

describe("an account intent that was sent (item 6)", () => {
  test("is not proved again when its proof expires", async () => {
    const { owner } = await makeStrk20Cosigner({ submitPrepared: async (hash) => hash });
    const send = (message: Record<string, unknown>) =>
      owner.handler(message, harnessExtensionSender);
    let intent = (await send({
      calls: [{ calldata: ["0x1"], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
      multisigId: HARNESS_MULTISIG_ID,
      type: "wallet.prepareArgentMultisigIntent",
    })) as unknown as { readonly intent: { readonly id: string } };
    for (const signerAccountId of [harnessAccountA.id, harnessAccountB.id]) {
      intent = (await send({
        intentId: intent.intent.id,
        signerAccountId,
        type: "wallet.signArgentMultisigIntent",
      })) as unknown as typeof intent;
    }
    await send({ intentId: intent.intent.id, type: "wallet.submitArgentMultisigIntent" });
    expect((await owner.multisigStore.getIntent(intent.intent.id))?.state).toBe("submitted");
    await owner.strk20MultisigStore.putProof({
      intentId: intent.intent.id,
      proof: relay("ready").proof,
      request: { kind: "register" },
    });
    await expect(
      send({ id: intent.intent.id, type: "wallet.refreshArgentMultisigStrk20" }),
    ).resolves.toEqual({ error: "Argent multisig intent was already sent" });
  });
});

describe("the only copy of the viewing key (M3)", () => {
  test("register and deposit wait until a co-owner holds the key", async () => {
    const { owner, send, sync } = await makeStrk20Cosigner();
    const prepare = (kind: string) =>
      owner
        .handler(
          {
            amount: "1",
            kind,
            multisigId: HARNESS_MULTISIG_ID,
            tokenId: "x",
            type: "wallet.prepareArgentMultisigStrk20",
          },
          harnessExtensionSender,
        )
        .catch((error: unknown) => ({ thrown: String(error) }));
    await expect(prepare("register")).resolves.toEqual({ error: MULTISIG_STRK20_SHARE_FIRST });
    await expect(prepare("deposit")).resolves.toEqual({ error: MULTISIG_STRK20_SHARE_FIRST });
    // A co-owner's copy of the same key arriving proves a second holder.
    await send(
      JSON.stringify({
        chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
        multisigId: HARNESS_MULTISIG_ID,
        poolAddress: POOL,
        version: 1,
        viewingKey: SCALAR,
      }),
      undefined,
      MULTISIG_STRK20_KEY_IDENTIFIER,
    );
    await expect(sync()).resolves.toMatchObject({ ok: true, strk20Key: "held" });
    await expect(prepare("register")).resolves.not.toEqual({ error: MULTISIG_STRK20_SHARE_FIRST });
  });
});

describe("removing a multisig with private rounds (L3)", () => {
  test("refuses while a relay is unsent, then leaves no rows behind", async () => {
    const { owner } = await makeStrk20Cosigner();
    const store = owner.strk20MultisigStore;
    expect(await store.upsertRelay(relay("ready"))).toBe("stored");
    await store.upsertAuthorization(callSet(), SCALAR);
    const remove = () =>
      owner.handler(
        {
          confirmHistoryRemoval: true,
          multisigId: HARNESS_MULTISIG_ID,
          type: "wallet.removeMultisig",
        },
        harnessExtensionSender,
      );
    await expect(remove()).resolves.toEqual({
      error: "Argent multisig has a pending or unresolved operation",
    });
    expect(await store.upsertRelay(relay("submitted"))).toBe("stored");
    await expect(remove()).resolves.toEqual({ ok: true });
    expect(await store.listAuthorizations(HARNESS_MULTISIG_ID, SCALAR)).toEqual([]);
    expect(await store.getRelay(relay("ready").id)).toBeNull();
  });
});

describe("this wallet's own first signature (review before signing)", () => {
  const proving = (actions: readonly (readonly string[])[]) =>
    ({
      async poolFee() {
        return "0x1";
      },
      async prepare() {
        throw new Error("unused");
      },
      async prepareRegistration(input: {
        readonly signCallSet: (hash: string, calls: readonly Call[]) => Promise<unknown>;
      }) {
        const calls = [
          {
            calldata: [...compileActionsCalldata(HARNESS_MULTISIG, SCALAR, actions)],
            contractAddress: POOL,
            entrypoint: "compile_actions",
          },
        ];
        const hash = computeStrk20CallSetHash(
          HARNESS_MULTISIG,
          calls,
          STARKNET_NETWORKS.SN_MAIN.chainId,
        );
        await input.signCallSet(num.toHex(hash), calls);
        throw new Error("unreachable");
      },
    }) as unknown as Strk20Service;
  const register = async (actions: readonly (readonly string[])[]) => {
    const cosigner = await makeStrk20Cosigner({ strk20: proving(actions) });
    await cosigner.owner.strk20MultisigStore.markKeyShared(HARNESS_MULTISIG_ID, true);
    const result = await cosigner.owner
      .handler(
        {
          kind: "register",
          multisigId: HARNESS_MULTISIG_ID,
          type: "wallet.prepareArgentMultisigStrk20",
        },
        harnessExtensionSender,
      )
      .catch((error: unknown) => ({ thrown: String(error) }));
    return { result, signatures: cosigner.signatures() };
  };

  test("signs a CallSet that decodes, and refuses one that does not", async () => {
    const decodable = await register([setViewingKey()]);
    expect(decodable.result).toMatchObject({ ok: true, phase: "authorization" });
    expect(decodable.signatures).toBe(1);
    const opaque = await register([setViewingKey(), invokeExternal("0xbad")]);
    expect(JSON.stringify(opaque.result)).toContain("Invalid Argent multisig private proof");
    expect(opaque.signatures).toBe(0);
  });
});
