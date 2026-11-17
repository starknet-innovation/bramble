/**
 * How a discovered-history merge treats rows the wallet already holds.
 *
 * - #653 (and Sherlock 150 before it): no discovered row settles a pending
 *   local transaction, from either lane. A reverted transaction still pays its
 *   fee, and the fee payment emits a `Transfer` from the account, so a
 *   `Transfer` for the hash is not evidence of success. Only the status
 *   re-poll settles it; `accepted` cannot be walked back and would cancel the
 *   "could not confirm" notice.
 * - Sherlock 204: a merged multi-leg transaction is persisted and comes back
 *   as `local` on the next merge. Local rows are keyed per leg, so every leg
 *   survives any number of round trips.
 */
import { describe, expect, test } from "bun:test";
import type { ActivityEntry } from "@bramble/transactions/activity";
import {
  decodeTransferEvent,
  mergeActivity,
  onChainActivityEntry,
  TRANSFER_EVENT_KEY,
} from "@bramble/transactions/tx-history";
import type { TokenConfig } from "@bramble/wallet-model/preferences";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const ACCOUNT_ID = `SN_MAIN:${ACCOUNT}`;
const SEQUENCER = "0x01176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8";
const STRK_ADDRESS = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const strk: TokenConfig = {
  address: STRK_ADDRESS,
  decimals: 18,
  id: `SN_MAIN:STRK:${STRK_ADDRESS}`,
  name: "Starknet Token",
  networkId: "SN_MAIN",
  symbol: "STRK",
};

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
  // A reverted transaction's only event: the fee payment, a STRK Transfer from
  // the account to the block's sequencer for the actual fee (#653).
  const feeTransferRow = (hash: string): ActivityEntry => {
    const decoded = decodeTransferEvent(
      {
        block_number: 900_000,
        data: ["31400000000000000", "0"],
        keys: [TRANSFER_EVENT_KEY, ACCOUNT, SEQUENCER],
        transaction_hash: hash,
      },
      ACCOUNT,
    );
    if (decoded === null) throw new Error("fee transfer did not decode");
    return onChainActivityEntry({
      accountId: ACCOUNT_ID,
      decoded,
      networkId: "SN_MAIN",
      timestampMs: 9_000,
      token: strk,
    });
  };

  test("a reverted transaction's fee Transfer never promotes it", () => {
    for (const status of ["pending", "preconfirmed"] as const) {
      const merged = mergeActivity([local(status)], [feeTransferRow("0x07ab")]);
      expect(merged).toHaveLength(1);
      expect(merged[0]?.status).toBe(status);
      expect(merged[0]?.summary).toBe("Send 1 STRK");
    }
  });

  test("a value Transfer for the hash does not settle it either", () => {
    for (const status of ["pending", "preconfirmed"] as const) {
      const [merged] = mergeActivity([local(status)], [leg("STRK", "1", "0x07ab")]);
      expect(merged?.status).toBe(status);
    }
  });

  test("a discovered row still adds history the wallet does not hold", () => {
    const merged = mergeActivity([local("pending")], [leg("USDC", "3")]);
    expect(merged.map((entry) => entry.hash).sort()).toEqual(["0x5a9", "0x7ab"]);
  });
});

describe("a stored multi-leg transaction", () => {
  const legs = [leg("ETH", "1.5"), leg("USDC", "3000"), leg("STRK", "0.1")];

  test("keeps every leg across repeated merges", () => {
    let stored = mergeActivity([], legs);
    expect(stored).toHaveLength(3);
    for (let scan = 0; scan < 3; scan += 1) {
      stored = mergeActivity(stored, legs);
      expect(stored).toHaveLength(3);
    }
    expect(stored.map((entry) => entry.token).sort()).toEqual(["ETH", "STRK", "USDC"]);
  });

  test("keeps every leg when the next scan returns nothing", () => {
    const stored = mergeActivity([], legs);
    expect(mergeActivity(stored, [])).toHaveLength(3);
  });
});
