/**
 * The optional `submittedPrice` field on stored activity rows (mc-wallet issue
 * 480). Rows from before it existed still load, a well-formed price loads with
 * them, and a malformed one fails the row's validation rather than reaching the
 * feed or the export.
 */
import { describe, expect, test } from "bun:test";
import { type ActivityEntry, isActivityEntry } from "@bramble/transactions/activity";

const row: ActivityEntry = {
  accountId: "SN_MAIN:0x1",
  amount: "1",
  hash: "0xabc",
  kind: "transfer",
  networkId: "SN_MAIN",
  origin: "wallet",
  status: "accepted",
  submittedAt: 1_700_000_000_000,
  summary: "Sent 1 STRK",
};

const price = { currency: "usd", pricedAt: 1_699_999_990_000, unitPrice: 0.12 };

describe("submittedPrice", () => {
  test("is optional, and a well-formed price loads", () => {
    expect(isActivityEntry(row)).toBe(true);
    expect(isActivityEntry({ ...row, submittedPrice: price })).toBe(true);
  });

  test("rejects a malformed price", () => {
    for (const submittedPrice of [
      null,
      "0.12",
      { ...price, currency: "jpy" },
      { ...price, unitPrice: 0 },
      { ...price, unitPrice: -1 },
      { ...price, unitPrice: Number.POSITIVE_INFINITY },
      { ...price, pricedAt: -1 },
      { ...price, pricedAt: 1.5 },
      { ...price, extra: true },
      { currency: "usd", unitPrice: 0.12 },
    ]) {
      expect(isActivityEntry({ ...row, submittedPrice })).toBe(false);
    }
  });
});
