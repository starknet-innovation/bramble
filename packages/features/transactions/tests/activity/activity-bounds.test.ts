/**
 * Activity rows stay within what the store and the screen can hold.
 *
 * - Sherlock 180: a summary built from a long dapp origin is shortened, not
 *   refused, so an approved and broadcast transaction is still recorded and
 *   observed. A long origin keeps its end, where the registrable domain is.
 * - Sherlock 238: a `submittedAt` past the ECMAScript Date range is refused at
 *   discovery and on read, because every date formatter throws on it.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import {
  activityOrigin,
  createActivityLog,
  isActivityEntry,
  MAX_ACTIVITY_TIMESTAMP_MS,
  memoryActivityLog,
} from "@bramble/transactions/activity";
import { TRANSFER_EVENT_KEY } from "@bramble/transactions/tx-history";
import { collectTransactionHistory } from "@bramble/transactions/tx-history-scan";
import type { TokenConfig } from "@bramble/wallet-model/preferences";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const ACCOUNT_ID = `SN_MAIN:${ACCOUNT}`;
const OTHER = "0x777";
const ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const eth: TokenConfig = {
  address: ETH,
  decimals: 18,
  id: `SN_MAIN:ETH:${ETH}`,
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
};
const LONG_ORIGIN = `https://${"a".repeat(180)}.example.com`;

const row = (submittedAt: number) => ({
  accountId: ACCOUNT_ID,
  hash: "0xabc",
  kind: "transfer" as const,
  networkId: "SN_MAIN" as const,
  status: "accepted" as const,
  submittedAt,
  summary: "Received 1 ETH",
});

describe("long summaries", () => {
  test("keep a short origin as it is and the end of a long one", () => {
    expect(activityOrigin("https://app.example.com")).toBe("https://app.example.com");
    const shortened = activityOrigin(LONG_ORIGIN);
    expect(shortened).toHaveLength(80);
    expect(shortened.startsWith("…")).toBe(true);
    expect(shortened.endsWith(".example.com")).toBe(true);
  });

  for (const [name, makeLog] of [
    ["persistent", () => createActivityLog({ now: () => 5, store: createMemoryStore() })],
    ["memory", () => memoryActivityLog(() => 5)],
  ] as const) {
    test(`are cut rather than refused by the ${name} log`, async () => {
      const log = makeLog();
      await log.record({
        accountId: ACCOUNT_ID,
        hash: "0xabc",
        kind: "invoke",
        networkId: "SN_MAIN",
        origin: "wallet",
        summary: `${LONG_ORIGIN} submitted 3 calls`,
      });
      const [entry] = await log.list();
      expect(entry?.summary).toHaveLength(200);
      expect(entry?.summary.endsWith("…")).toBe(true);
      expect(entry?.status).toBe("pending");
    });
  }
});

describe("timestamps past the Date range", () => {
  test("are refused by the validator, and the last representable instant is kept", () => {
    expect(isActivityEntry(row(MAX_ACTIVITY_TIMESTAMP_MS))).toBe(true);
    expect(isActivityEntry(row(MAX_ACTIVITY_TIMESTAMP_MS + 1_000))).toBe(false);
  });

  test("drop an already stored row on read instead of breaking the feed", async () => {
    const store = createMemoryStore();
    await store.set("bramble:activity", [
      row(MAX_ACTIVITY_TIMESTAMP_MS + 1_000),
      { ...row(1_700_000_000_000), hash: "0xdef" },
    ]);
    const entries = await createActivityLog({ store }).list();
    expect(entries.map((entry) => entry.hash)).toEqual(["0xdef"]);
  });

  test("drop a discovered row whose block timestamp is out of range", async () => {
    const entries = await collectTransactionHistory(
      {
        async getBlockTimestamp(blockNumber) {
          return blockNumber === 100 ? 8_640_000_000_001 : 1_700_000_000;
        },
        async getEvents() {
          return {
            events: [
              {
                block_number: 100,
                data: ["1", "0"],
                keys: [TRANSFER_EVENT_KEY, OTHER, ACCOUNT],
                transaction_hash: "0xa11",
              },
              {
                block_number: 101,
                data: ["2", "0"],
                keys: [TRANSFER_EVENT_KEY, OTHER, ACCOUNT],
                transaction_hash: "0xb22",
              },
            ],
          };
        },
        async getLatestBlockNumber() {
          return 500;
        },
      },
      { account: ACCOUNT, accountId: ACCOUNT_ID, networkId: "SN_MAIN", tokens: [eth] },
    );
    expect(entries.map((entry) => entry.hash)).toEqual(["0xb22"]);
  });
});

describe("recorded direction (Sherlock 196)", () => {
  test("accepts in and out, and refuses anything else", () => {
    expect(isActivityEntry({ ...row(1), direction: "in" })).toBe(true);
    expect(isActivityEntry({ ...row(1), direction: "out" })).toBe(true);
    expect(isActivityEntry({ ...row(1), direction: "sideways" })).toBe(false);
  });
});
