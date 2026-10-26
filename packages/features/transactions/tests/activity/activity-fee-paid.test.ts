/**
 * The optional `feePaid` field on stored activity rows (GitHub 463). Rows from
 * before it existed still load, a well-formed fee loads with them, and a
 * malformed one fails the row's validation rather than reaching the feed. A
 * row marked `feePayer: "sponsor"` (#431) never takes a receipt fee.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import {
  type ActivityEntry,
  createActivityLog,
  isActivityEntry,
} from "@bramble/transactions/activity";

const row: ActivityEntry = {
  accountId: "SN_MAIN:0x1",
  hash: "0xabc",
  kind: "transfer",
  networkId: "SN_MAIN",
  origin: "wallet",
  status: "accepted",
  submittedAt: 1_700_000_000_000,
  summary: "Sent 1 STRK",
};

describe("feePaid", () => {
  test("is optional, so rows stored before it existed still load", () => {
    expect(isActivityEntry(row)).toBe(true);
  });

  test("loads a well-formed fee in either unit", () => {
    expect(isActivityEntry({ ...row, feePaid: { amount: "0xabc", unit: "FRI" } })).toBe(true);
    expect(isActivityEntry({ ...row, feePaid: { amount: "0x1", unit: "WEI" } })).toBe(true);
  });

  test("rejects a row whose fee is malformed", () => {
    for (const feePaid of [
      "0xabc",
      { amount: "0xabc" },
      { amount: "0xABC", unit: "FRI" },
      { amount: "0xabc", unit: "STRK" },
      { amount: "0xabc", note: "estimate", unit: "FRI" },
      null,
    ]) {
      expect(isActivityEntry({ ...row, feePaid })).toBe(false);
    }
  });
});

describe("feePayer", () => {
  test("loads only the sponsor marker, so legacy rows still mean the account paid", () => {
    expect(isActivityEntry({ ...row, feePayer: "sponsor" })).toBe(true);
    for (const feePayer of ["account", "Sponsor", null, true]) {
      expect(isActivityEntry({ ...row, feePayer })).toBe(false);
    }
  });

  test("a sponsored row never takes the receipt fee, which was the sponsor's", async () => {
    const log = createActivityLog({ now: () => 1, store: createMemoryStore() });
    const scope = { accountId: row.accountId, networkId: row.networkId };
    await log.record({ ...row, feePayer: "sponsor", hash: "0x1", kind: "deploy" });
    await log.record({ ...row, hash: "0x2", kind: "deploy" });
    const fee = { amount: "0xabc", unit: "FRI" } as const;
    const updated = await log.updateStatuses(
      { "0x1": { feePaid: fee, status: "accepted" }, "0x2": { feePaid: fee, status: "accepted" } },
      scope,
    );
    const byHash = new Map(updated.map((entry) => [entry.hash, entry]));
    expect(byHash.get("0x1")?.feePaid).toBeUndefined();
    expect(byHash.get("0x1")?.feePayer).toBe("sponsor");
    expect(byHash.get("0x2")?.feePaid).toEqual(fee);
  });
});
