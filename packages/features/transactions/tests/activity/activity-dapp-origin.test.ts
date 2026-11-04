/**
 * The site a dapp transaction came from (mc-wallet issue 749). The field is
 * optional, so older rows keep loading; a well-formed origin round-trips; a
 * malformed one fails the row's validation; and the writers' helper drops an
 * origin the row cannot hold instead of costing the row itself.
 */
import { describe, expect, test } from "bun:test";
import {
  activityDappOrigin,
  isActivityEntry,
  memoryActivityLog,
} from "@bramble/transactions/activity";
import { mergeActivity } from "@bramble/transactions/tx-history";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  accountId: ACCOUNT_ID,
  hash: "0x1",
  kind: "invoke",
  networkId: "SN_MAIN",
  origin: "wallet",
  status: "pending",
  submittedAt: 1,
  summary: "https://app.example.com submitted 1 call",
  ...overrides,
});

describe("activity dappOrigin", () => {
  test("a row without it, as every older row is, still validates", () => {
    expect(isActivityEntry(row())).toBe(true);
  });

  test("an http(s) origin validates; anything else fails the row", () => {
    expect(isActivityEntry(row({ dappOrigin: "https://app.example.com" }))).toBe(true);
    expect(isActivityEntry(row({ dappOrigin: "http://localhost:5173" }))).toBe(true);
    for (const dappOrigin of [
      "",
      "https://app.example.com/",
      "https://app.example.com/path",
      "chrome-extension://abc",
      "app.example.com",
      `https://${"a".repeat(260)}.com`,
      42,
    ]) {
      expect(isActivityEntry(row({ dappOrigin }))).toBe(false);
    }
  });

  test("the writers' helper keeps a plain origin and drops one the row cannot hold", () => {
    expect(activityDappOrigin("https://app.example.com")).toEqual({
      dappOrigin: "https://app.example.com",
    });
    expect(activityDappOrigin("chrome-extension://abc")).toEqual({});
    expect(activityDappOrigin(`https://${"a".repeat(260)}.com`)).toEqual({});
  });

  test("a recorded row keeps its site, and an odd origin still records the row", async () => {
    const log = memoryActivityLog(() => 5);
    await log.record({
      accountId: ACCOUNT_ID,
      ...activityDappOrigin("https://app.example.com"),
      hash: "0x1",
      kind: "invoke",
      networkId: "SN_MAIN",
      summary: "https://app.example.com submitted 1 call",
    });
    await log.record({
      accountId: ACCOUNT_ID,
      ...activityDappOrigin("chrome-extension://abc"),
      hash: "0x2",
      kind: "invoke",
      networkId: "SN_MAIN",
      summary: "chrome-extension://abc submitted 1 call",
    });
    const rows = await log.list();
    expect(rows.find((entry) => entry.hash === "0x1")?.dappOrigin).toBe("https://app.example.com");
    expect(rows.find((entry) => entry.hash === "0x2")).toBeDefined();
    expect(rows.find((entry) => entry.hash === "0x2")?.dappOrigin).toBeUndefined();
  });

  test("a history merge keeps the local row's site", () => {
    const local = row({ dappOrigin: "https://app.example.com" });
    if (!isActivityEntry(local)) throw new Error("fixture");
    // The chain's copy of the same transaction carries no site and no provenance.
    const { dappOrigin: _site, origin: _origin, ...discovered } = { ...local, summary: "Called" };
    const [merged] = mergeActivity([local], [discovered]);
    expect(merged?.dappOrigin).toBe("https://app.example.com");
  });
});
