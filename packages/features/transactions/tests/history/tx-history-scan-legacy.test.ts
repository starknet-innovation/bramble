/**
 * The RPC history scan and legacy (Cairo 0) ERC20 tokens (Sherlock 223).
 *
 * A legacy token indexes only the `Transfer` selector and carries `from`, `to`
 * and the amount in `data`, so the account-key filters can never match its
 * events. The scan probes one event to learn the layout, reads a legacy token
 * by selector alone, and keeps only the transfers whose data names the
 * account.
 */
import { describe, expect, test } from "bun:test";
import { TRANSFER_EVENT_KEY } from "@bramble/transactions/tx-history";
import {
  collectTransactionHistory,
  type HistoryEventFilter,
  type HistoryRpc,
} from "@bramble/transactions/tx-history-scan";
import type { TokenConfig } from "@bramble/wallet-model/preferences";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const OTHER = "0x0777000000000000000000000000000000000000000000000000000000000abc";
const THIRD = "0x0888000000000000000000000000000000000000000000000000000000000def";
const LEGACY_ADDRESS = "0x5ca1e";

const legacyToken: TokenConfig = {
  address: LEGACY_ADDRESS,
  decimals: 18,
  id: `SN_MAIN:LGC:${LEGACY_ADDRESS}`,
  name: "Legacy Token",
  networkId: "SN_MAIN",
  symbol: "LGC",
};

// Legacy events: only the selector is a key.
const LEGACY_EVENTS = [
  {
    block_number: 100,
    data: [OTHER, ACCOUNT, "2000000000000000000", "0"],
    keys: [TRANSFER_EVENT_KEY],
    transaction_hash: "0xa11",
  },
  {
    block_number: 101,
    data: [ACCOUNT, OTHER, "1000000000000000000", "0"],
    keys: [TRANSFER_EVENT_KEY],
    transaction_hash: "0xb22",
  },
  {
    block_number: 102,
    data: [OTHER, THIRD, "9", "0"],
    keys: [TRANSFER_EVENT_KEY],
    transaction_hash: "0xc33",
  },
];

const legacyRpc = (filters: HistoryEventFilter[]): HistoryRpc => ({
  async getBlockTimestamp(blockNumber) {
    return 1_700_000_000 + blockNumber;
  },
  async getEvents(filter) {
    filters.push(filter);
    // A node applies key filters: an account key never matches a legacy event.
    const keyFiltered = filter.keys.length > 1;
    return { events: keyFiltered ? [] : LEGACY_EVENTS.slice(0, filter.chunk_size) };
  },
  async getLatestBlockNumber() {
    return 500;
  },
});

describe("legacy Transfer layout", () => {
  test("finds the account's incoming and outgoing transfers of a legacy token", async () => {
    const filters: HistoryEventFilter[] = [];
    const entries = await collectTransactionHistory(legacyRpc(filters), {
      account: ACCOUNT,
      accountId: `SN_MAIN:${ACCOUNT}`,
      networkId: "SN_MAIN",
      tokens: [legacyToken],
    });

    expect(entries.map((entry) => [entry.hash, entry.summary.split(" ")[0]])).toEqual([
      ["0xb22", "Sent"],
      ["0xa11", "Received"],
    ]);
    // The probe, then one selector-only read; the account-key filters are
    // skipped because they cannot match this layout.
    expect(filters.map((filter) => filter.keys)).toEqual([
      [[TRANSFER_EVENT_KEY]],
      [[TRANSFER_EVENT_KEY]],
    ]);
    expect(filters[0]?.chunk_size).toBe(1);
  });
});
