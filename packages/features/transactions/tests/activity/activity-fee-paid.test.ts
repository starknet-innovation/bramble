/**
 * The optional `feePaid` field on stored activity rows (GitHub 463). Rows from
 * before it existed still load, a well-formed fee loads with them, and a
 * malformed one fails the row's validation rather than reaching the feed.
 */
import { describe, expect, test } from "bun:test";
import { type ActivityEntry, isActivityEntry } from "@bramble/transactions/activity";

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
