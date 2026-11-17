/**
 * Store rules for multisig STRK20 rounds: parallel co-signers merge, one
 * multisig's traffic cannot evict another's or a live round, a removed
 * multisig leaves nothing behind, and a package binds to this multisig only.
 */
import { describe, expect, test } from "bun:test";
import type { MultisigStrk20RelayRequest } from "@bramble/privacy/multisig-strk20";
import { isBoundToMultisig } from "@bramble/privacy/multisig-strk20-binding";
import {
  isMultisigStrk20RelayInvite,
  multisigStrk20RelayInviteFrom,
} from "@bramble/privacy/multisig-strk20-relay-invite";
import { createMultisigStrk20Store } from "@bramble/privacy/multisig-strk20-store";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { createMemoryStore } from "@bramble/store/kv";
import { STARKNET_NETWORKS, STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { ec, num, typedData } from "starknet";
import { callSetAuthorization, deposit } from "../support/multisig-callset";
import { paymasterTypedData } from "../support/paymaster";

const SCALAR = "0x654321";
const ACCOUNT = "0x123";
const ACCOUNT_ID = `SN_MAIN:${ACCOUNT}`;
const OTHER_ID = "SN_MAIN:0x456";
const CHAIN = STARKNET_NETWORKS.SN_MAIN.chainId;
const POOL = "0x9001";

const signer = (privateKey: string) => ({
  privateKey,
  publicKey: ec.starkCurve.getStarkKey(privateKey),
});
const [A, B, C] = ["0x11", "0x22", "0x33"]
  .map(signer)
  .sort((left, right) =>
    BigInt(argentSignerGuid(left.publicKey)) < BigInt(argentSignerGuid(right.publicKey)) ? -1 : 1,
  ) as [ReturnType<typeof signer>, ReturnType<typeof signer>, ReturnType<typeof signer>];
const KEYS = [A.publicKey, B.publicKey, C.publicKey];

const round = (
  signWith: readonly ReturnType<typeof signer>[],
  overrides: {
    readonly accountId?: string;
    readonly amount?: bigint;
    readonly threshold?: number;
  } = {},
) =>
  callSetAuthorization({
    accountAddress: ACCOUNT,
    accountId: overrides.accountId ?? ACCOUNT_ID,
    actions: [deposit(STRK_TOKEN_ADDRESS, overrides.amount ?? 1n)],
    chainId: CHAIN,
    pool: POOL,
    scalar: SCALAR,
    signerPublicKeys: KEYS,
    signWith,
    threshold: overrides.threshold ?? 3,
  });

const relay = (
  accountId: string,
  fact: string,
  state: MultisigStrk20RelayRequest["state"],
): MultisigStrk20RelayRequest => ({
  accountAddress: ACCOUNT,
  accountId,
  call: { calldata: ["0x1"], contractAddress: POOL, entrypoint: "apply_actions" },
  feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
  fragments: [],
  id: `${accountId}:${fact}`,
  proof: {
    data: "aa",
    output: ["0x1"],
    proof_facts: ["0x1", "0x2", "0x3", "0x4", "0x5", "0x6", "0x7", "0x1", fact],
  },
  request: { amount: "0x10", kind: "transfer", recipient: "0x6", token: "0x7" },
  signerPublicKeys: KEYS,
  state,
  summary: "Transfer from this multisig's private balance",
  threshold: 2,
});

describe("multisig STRK20 parallel co-signers", () => {
  test("merges two co-owners' fragments for one 3-of-3 round instead of a conflict", async () => {
    const store = createMultisigStrk20Store(createMemoryStore());
    expect(await store.upsertAuthorization(round([A]), SCALAR)).toBe("stored");
    expect(await store.upsertAuthorization(round([A, B]), SCALAR)).toBe("stored");
    expect(await store.upsertAuthorization(round([A, C]), SCALAR)).toBe("stored");
    const merged = await store.getAuthorization(round([]).id, SCALAR);
    expect(merged?.state).toBe("ready");
    expect(merged?.fragments.map((fragment) => fragment.publicKey)).toEqual(KEYS);
  });

  test("still refuses a different round under the same id", async () => {
    const store = createMultisigStrk20Store(createMemoryStore());
    const first = round([A]);
    expect(await store.upsertAuthorization(first, SCALAR)).toBe("stored");
    expect(
      await store.upsertAuthorization({ ...first, summary: "Withdraw something else" }, SCALAR),
    ).toBe("conflict");
  });
});

describe("multisig STRK20 per-multisig capacity", () => {
  test("a full multisig refuses a new round and never evicts a collecting one", async () => {
    const store = createMultisigStrk20Store(createMemoryStore());
    const other = round([], { accountId: OTHER_ID });
    expect(await store.upsertAuthorization(other, SCALAR)).toBe("stored");
    for (let amount = 1n; amount <= 25n; amount += 1n) {
      expect(await store.upsertAuthorization(round([], { amount }), SCALAR)).toBe("stored");
    }
    expect(await store.upsertAuthorization(round([], { amount: 26n }), SCALAR)).toBe("full");
    expect(await store.getAuthorization(other.id, SCALAR)).not.toBeNull();
    expect(await store.listAuthorizations(ACCOUNT_ID, SCALAR)).toHaveLength(25);
  });

  test("a ready round makes room; collecting rounds stay", async () => {
    const store = createMultisigStrk20Store(createMemoryStore());
    const used = round([A, B, C], { amount: 1n });
    expect(used.state).toBe("ready");
    expect(await store.upsertAuthorization(used, SCALAR)).toBe("stored");
    for (let amount = 2n; amount <= 25n; amount += 1n) {
      expect(await store.upsertAuthorization(round([], { amount }), SCALAR)).toBe("stored");
    }
    expect(await store.upsertAuthorization(round([], { amount: 26n }), SCALAR)).toBe("stored");
    expect(await store.getAuthorization(used.id, SCALAR)).toBeNull();
    expect(await store.listAuthorizations(ACCOUNT_ID, SCALAR)).toHaveLength(25);
  });

  test("a relay holding the only proof is never evicted; a submitted one is", async () => {
    const store = createMultisigStrk20Store(createMemoryStore());
    const keep = relay(OTHER_ID, "0x100", "ready");
    expect(await store.upsertRelay(keep)).toBe("stored");
    for (let index = 1; index <= 8; index += 1) {
      expect(await store.upsertRelay(relay(ACCOUNT_ID, num.toHex(index), "ready"))).toBe("stored");
    }
    expect(await store.upsertRelay(relay(ACCOUNT_ID, "0x9", "ready"))).toBe("full");
    expect(await store.getRelay(keep.id)).not.toBeNull();
    expect(await store.upsertRelay(relay(ACCOUNT_ID, "0x1", "submitted"))).toBe("stored");
    expect(await store.upsertRelay(relay(ACCOUNT_ID, "0x9", "ready"))).toBe("stored");
    expect(await store.getRelay(`${ACCOUNT_ID}:0x1`)).toBeNull();
  });
});

describe("removing a multisig's STRK20 rows", () => {
  test("reports a live relay, then purges every row and proof for that multisig only", async () => {
    const store = createMultisigStrk20Store(createMemoryStore());
    await store.upsertAuthorization(round([A]), SCALAR);
    await store.upsertRelay(relay(ACCOUNT_ID, "0x1", "ready"));
    await store.upsertRelay(relay(OTHER_ID, "0x2", "ready"));
    await store.putProof({
      intentId: `${ACCOUNT_ID}:0xabc`,
      proof: relay(ACCOUNT_ID, "0x1", "ready").proof,
      request: { kind: "register" },
    });
    await store.markKeyShared(ACCOUNT_ID, true);
    expect(await store.hasLiveRelay(ACCOUNT_ID)).toBe(true);
    expect(await store.isKeyShared(ACCOUNT_ID)).toBe(true);
    await store.purgeAccount(ACCOUNT_ID);
    expect(await store.listAuthorizations(ACCOUNT_ID, SCALAR)).toEqual([]);
    expect(await store.listRelays(ACCOUNT_ID)).toEqual([]);
    expect(await store.listInvites(ACCOUNT_ID)).toEqual([]);
    expect(await store.getProof(`${ACCOUNT_ID}:0xabc`)).toBeNull();
    expect(await store.hasLiveRelay(ACCOUNT_ID)).toBe(false);
    expect(await store.isKeyShared(ACCOUNT_ID)).toBe(false);
    expect(await store.hasLiveRelay(OTHER_ID)).toBe(true);
  });
});

describe("multisig STRK20 binding", () => {
  const binding = {
    accountAddress: ACCOUNT,
    accountId: ACCOUNT_ID,
    chainId: CHAIN,
    signerPublicKeys: KEYS,
    threshold: 3,
  };

  test("binds only to this multisig's address, chain, signer set, and threshold", () => {
    const row = round([]);
    expect(isBoundToMultisig(row, binding)).toBe(true);
    expect(isBoundToMultisig({ ...row, signerPublicKeys: [...KEYS].reverse() }, binding)).toBe(
      true,
    );
    expect(isBoundToMultisig({ ...row, accountAddress: "0x999" }, binding)).toBe(false);
    expect(isBoundToMultisig({ ...row, accountId: OTHER_ID }, binding)).toBe(false);
    expect(
      isBoundToMultisig({ ...row, chainId: STARKNET_NETWORKS.SN_SEPOLIA.chainId }, binding),
    ).toBe(false);
    expect(isBoundToMultisig({ ...row, threshold: 2 }, binding)).toBe(false);
    expect(
      isBoundToMultisig({ ...row, signerPublicKeys: [A.publicKey, B.publicKey] }, binding),
    ).toBe(false);
    expect(
      isBoundToMultisig({ ...row, signerPublicKeys: [A.publicKey, B.publicKey, "0x77"] }, binding),
    ).toBe(false);
  });
});

describe("multisig STRK20 relay invite fragments", () => {
  test("refuses an invite that repeats one signer's fragment", () => {
    const typed = paymasterTypedData();
    const messageHash = num.toHex(typedData.getMessageHash(typed, ACCOUNT));
    const signed = ec.starkCurve.sign(messageHash, A.privateKey);
    const fragment = { publicKey: A.publicKey, r: num.toHex(signed.r), s: num.toHex(signed.s) };
    const invite = multisigStrk20RelayInviteFrom({
      accountAddress: ACCOUNT,
      accountId: ACCOUNT_ID,
      fragments: [fragment],
      id: `${ACCOUNT_ID}:${messageHash}`,
      messageHash,
      signerPublicKeys: [A.publicKey, B.publicKey],
      summary: "Transfer from this multisig's private balance",
      threshold: 2,
      typedData: typed,
    });
    expect(invite).not.toBeNull();
    expect(isMultisigStrk20RelayInvite({ ...invite, fragments: [fragment, fragment] })).toBe(false);
    expect(
      isMultisigStrk20RelayInvite({ ...invite, signerPublicKeys: [A.publicKey, A.publicKey] }),
    ).toBe(false);
  });
});
