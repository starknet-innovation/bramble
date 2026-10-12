/**
 * How a discovered-history merge treats rows the wallet already holds.
 *
 * - Sherlock 150: only the wallet's own RPC event scan settles a pending local
 *   transaction as accepted. An explorer row is a third party's HTTP answer:
 *   it adds history but never changes the status of a transaction the wallet
 *   is still observing, because `accepted` cannot be walked back and would
 *   cancel the "could not confirm" notice.
 * - Sherlock 204: a merged multi-leg transaction is persisted and comes back
 *   as `local` on the next merge. Local rows are keyed per leg, so every leg
 *   survives any number of round trips.
 */
import { describe, expect, test } from "bun:test";
import type { ActivityEntry } from "@bramble/transactions/activity";
import { mergeActivity } from "@bramble/transactions/tx-history";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const local = (status: ActivityEntry["status"]): ActivityEntry => ({
  accountId: ACCOUNT_ID,
  hash: "0x7ab",
  kind: "transfer",
  networkId: "SN_MAIN",
  origin: "wallet",
  status,
  submittedAt: 4_000,
  summary: "Send 1 STRK",
});

const leg = (token: string, amount: string, hash = "0x5a9"): ActivityEntry => ({
  accountId: ACCOUNT_ID,
  amount,
  counterparty: "0x777",
  hash,
  kind: "transfer",
  networkId: "SN_MAIN",
  status: "accepted",
  submittedAt: 9_000,
  summary: `Received ${amount} ${token} from 0x777`,
  token,
});

describe("settling a pending local transaction", () => {
  test("the wallet's own event scan settles it", () => {
    const [merged] = mergeActivity(
      [local("pending")],
      [leg("STRK", "1", "0x07ab")],
      "chain-events",
    );
    expect(merged?.status).toBe("accepted");
  });

  test("an explorer row does not, for pending or pre-confirmed", () => {
    for (const status of ["pending", "preconfirmed"] as const) {
      const merged = mergeActivity([local(status)], [leg("STRK", "1", "0x07ab")], "explorer");
      expect(merged).toHaveLength(1);
      expect(merged[0]?.status).toBe(status);
      expect(merged[0]?.summary).toBe("Send 1 STRK");
    }
  });

  test("an explorer row still adds history the wallet does not hold", () => {
    const merged = mergeActivity([local("pending")], [leg("USDC", "3")], "explorer");
    expect(merged.map((entry) => entry.hash).sort()).toEqual(["0x5a9", "0x7ab"]);
  });
});

describe("a stored multi-leg transaction", () => {
  const legs = [leg("ETH", "1.5"), leg("USDC", "3000"), leg("STRK", "0.1")];

  test("keeps every leg across repeated merges", () => {
    let stored = mergeActivity([], legs, "chain-events");
    expect(stored).toHaveLength(3);
    for (let scan = 0; scan < 3; scan += 1) {
      stored = mergeActivity(stored, legs, "chain-events");
      expect(stored).toHaveLength(3);
    }
    expect(stored.map((entry) => entry.token).sort()).toEqual(["ETH", "STRK", "USDC"]);
  });

  test("keeps every leg when the next scan returns nothing", () => {
    const stored = mergeActivity([], legs, "explorer");
    expect(mergeActivity(stored, [], "chain-events")).toHaveLength(3);
  });
});
