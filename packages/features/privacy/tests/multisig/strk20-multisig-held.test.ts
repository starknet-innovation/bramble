/**
 * Held proof requests in the multisig STRK20 store: only an envelope without
 * calldata or a signature is kept, rows stay with their own multisig, the
 * oldest makes room, a removed multisig leaves none behind, and the rebuilt
 * `__execute__` calldata matches what starknet.js builds for the same call.
 */
import { describe, expect, test } from "bun:test";
import { MAX_MULTISIG_STRK20_AUTHORIZATIONS } from "@bramble/privacy/multisig-strk20";
import {
  isMultisigStrk20HeldProof,
  type MultisigStrk20HeldProof,
  multisigStrk20ExecuteCalldata,
  multisigStrk20HeldEnvelope,
  multisigStrk20HeldPlan,
  sameMultisigStrk20Felts,
} from "@bramble/privacy/multisig-strk20-held";
import { createMultisigStrk20Store } from "@bramble/privacy/multisig-strk20-store";
import { createMemoryStore } from "@bramble/store/kv";
import { num, transaction } from "starknet";

const ACCOUNT_ID = `SN_MAIN:0x${"1".repeat(63)}`;
const OTHER_ID = `SN_MAIN:0x${"2".repeat(63)}`;
const POOL = `0x${"3".repeat(63)}`;

const row = (accountId: string, digest: number): MultisigStrk20HeldProof => ({
  accountId,
  envelope: { nonce: "0x0", resource_bounds: { l2_gas: { max_amount: "0x0" } }, version: "0x3" },
  id: `${accountId}:${num.toHex(digest)}`,
  provingBlock: 100,
});

describe("held request rows", () => {
  test("refuse an envelope with calldata or a signature, and a foreign id", () => {
    expect(isMultisigStrk20HeldProof(row(ACCOUNT_ID, 1))).toBe(true);
    for (const field of ["calldata", "signature"]) {
      const bad = {
        ...row(ACCOUNT_ID, 1),
        envelope: { ...row(ACCOUNT_ID, 1).envelope, [field]: [] },
      };
      expect(isMultisigStrk20HeldProof(bad)).toBe(false);
    }
    expect(isMultisigStrk20HeldProof({ ...row(ACCOUNT_ID, 1), id: `${OTHER_ID}:0x1` })).toBe(false);
    expect(isMultisigStrk20HeldProof({ ...row(ACCOUNT_ID, 1), provingBlock: -1 })).toBe(false);
    expect(isMultisigStrk20HeldProof({ ...row(ACCOUNT_ID, 1), extra: true })).toBe(false);
  });

  test("the envelope drops calldata and the signature from a compiled request", () => {
    const envelope = multisigStrk20HeldEnvelope({
      calldata: ["0x1"],
      nonce: "0x5",
      signature: ["0x0"],
    });
    expect(envelope).toEqual({ nonce: "0x5" });
  });

  test("stay per multisig, the oldest makes room, and removal drops them", async () => {
    const store = createMultisigStrk20Store(createMemoryStore());
    for (let digest = 1; digest <= MAX_MULTISIG_STRK20_AUTHORIZATIONS + 1; digest += 1) {
      await expect(store.putHeld(row(ACCOUNT_ID, digest))).resolves.toBe("stored");
    }
    await store.putHeld(row(OTHER_ID, 1));
    const kept = await store.listHeld(ACCOUNT_ID);
    expect(kept).toHaveLength(MAX_MULTISIG_STRK20_AUTHORIZATIONS);
    expect(kept.map((entry) => entry.id)).not.toContain(row(ACCOUNT_ID, 1).id);
    await expect(store.getHeld(row(OTHER_ID, 1).id)).resolves.toEqual(row(OTHER_ID, 1));
    await store.purgeAccount(ACCOUNT_ID);
    await expect(store.listHeld(ACCOUNT_ID)).resolves.toEqual([]);
    await expect(store.listHeld(OTHER_ID)).resolves.toHaveLength(1);
  });

  test("refuse to store a row that fails validation, and refuse a locked write", async () => {
    const store = createMultisigStrk20Store(createMemoryStore());
    const bad = { ...row(ACCOUNT_ID, 1), envelope: { calldata: [] } };
    await expect(store.putHeld(bad as MultisigStrk20HeldProof)).resolves.toBe("invalid");
    await expect(store.putHeld(row(ACCOUNT_ID, 1), () => false)).resolves.toBe("unauthorized");
    await expect(store.listHeld(ACCOUNT_ID)).resolves.toEqual([]);
  });
});

describe("held relay plans", () => {
  test("are kept as plain JSON, and refused when not JSON or too large", () => {
    const plan = { feeAction: { amount: "0x1", recipient: "0x2", token: "0x3", type: "withdraw" } };
    expect(multisigStrk20HeldPlan(plan)).toEqual(plan);
    expect(multisigStrk20HeldPlan({ amount: 1n })).toBeNull();
    expect(multisigStrk20HeldPlan({ blob: "x".repeat(20_000) })).toBeNull();
    expect(multisigStrk20HeldPlan("not a record")).toBeNull();
  });
});

describe("rebuilt execute calldata", () => {
  test("matches starknet.js for the same pool call", () => {
    const call = {
      calldata: ["0x7", "0x0", "0x2", "0xabc"],
      contractAddress: POOL,
      entrypoint: "compile_actions",
    };
    const expected = transaction
      .getExecuteCalldata([call], "1")
      .map((felt) => num.toHex(felt as string));
    const rebuilt = multisigStrk20ExecuteCalldata(call);
    expect(rebuilt).not.toBeNull();
    expect(sameMultisigStrk20Felts(expected, rebuilt ?? [])).toBe(true);
    expect(sameMultisigStrk20Felts([...expected, "0x0"], rebuilt ?? [])).toBe(false);
  });
});
