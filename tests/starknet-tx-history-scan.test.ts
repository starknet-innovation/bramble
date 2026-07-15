/**
 * On-chain history scan checks driven by a fake RPC surface: matched transfers
 * across tracked tokens become dated activity entries, the cap bounds the feed,
 * a transport failure propagates so the caller can degrade, an account with no
 * matching events yields an empty feed, and a block whose timestamp cannot be
 * read is dropped rather than dated with a guess.
 */
import { describe, expect, test } from "bun:test";
import type { RpcProvider } from "starknet";
import { MAX_HISTORY_ENTRIES, TRANSFER_EVENT_KEY } from "../src/starknet/tx-history";
import {
  collectTransactionHistory,
  type HistoryEventFilter,
  type HistoryRpc,
  scanTransactionHistory,
} from "../src/starknet/tx-history-scan";
import type { TokenConfig } from "../src/storage/preferences-entries";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const OTHER = "0x0777000000000000000000000000000000000000000000000000000000000abc";
const ETH_ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const eth: TokenConfig = {
  address: ETH_ADDRESS,
  decimals: 18,
  id: `SN_MAIN:ETH:${ETH_ADDRESS}`,
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
};

type EmittedEvent = {
  readonly block_number: number;
  readonly data: readonly string[];
  readonly keys: readonly string[];
  readonly transaction_hash: string;
};

// One incoming and one outgoing Transfer, plus an unrelated third-party transfer
// that must be filtered out — the realistic shape a node returns for a token.
const EVENTS: readonly EmittedEvent[] = [
  {
    block_number: 100,
    data: ["1000000000000000000", "0"],
    keys: [TRANSFER_EVENT_KEY, OTHER, ACCOUNT],
    transaction_hash: "0xa11",
  },
  {
    block_number: 101,
    data: ["500000000000000000", "0"],
    keys: [TRANSFER_EVENT_KEY, ACCOUNT, OTHER],
    transaction_hash: "0xb22",
  },
  {
    block_number: 102,
    data: ["9", "0"],
    keys: [TRANSFER_EVENT_KEY, OTHER, OTHER],
    transaction_hash: "0xc33",
  },
];

const fakeRpc = (overrides: Partial<HistoryRpc> = {}): HistoryRpc => ({
  async getBlockTimestamp(blockNumber) {
    return 1_700_000_000 + blockNumber;
  },
  async getEvents() {
    return { events: EVENTS };
  },
  async getLatestBlockNumber() {
    return 500;
  },
  ...overrides,
});

const scanArgs = {
  account: ACCOUNT,
  accountId: `SN_MAIN:${ACCOUNT}`,
  networkId: "SN_MAIN" as const,
  tokens: [eth],
};

describe("collectTransactionHistory", () => {
  test("turns matched transfers into dated activity entries, newest first", async () => {
    const entries = await collectTransactionHistory(fakeRpc(), scanArgs);
    expect(entries.map((entry) => entry.hash)).toEqual(["0xb22", "0xa11"]);
    const [out, incoming] = entries;
    expect(out?.summary).toBe("Sent 0.5 ETH to 0x7770…0abc");
    expect(out?.submittedAt).toBe((1_700_000_000 + 101) * 1000);
    expect(incoming?.summary).toBe("Received 1 ETH from 0x7770…0abc");
    expect(incoming?.status).toBe("accepted");
  });

  test("bounds the recent-history query to a window below the latest block", async () => {
    const filters: HistoryEventFilter[] = [];
    await collectTransactionHistory(
      fakeRpc({
        async getEvents(filter) {
          filters.push(filter);
          return { events: EVENTS };
        },
        async getLatestBlockNumber() {
          return 1_000_000;
        },
      }),
      scanArgs,
    );
    expect(filters[0]?.from_block).toBe(800_000);
  });

  test("caps the feed and only fetches a timestamp once per block", async () => {
    const many: EmittedEvent[] = Array.from({ length: MAX_HISTORY_ENTRIES + 10 }, (_, index) => ({
      block_number: 200 + index,
      data: ["1", "0"],
      keys: [TRANSFER_EVENT_KEY, OTHER, ACCOUNT],
      transaction_hash: `0x${(index + 1).toString(16)}`,
    }));
    const timestampBlocks: number[] = [];
    const entries = await collectTransactionHistory(
      fakeRpc({
        async getBlockTimestamp(blockNumber) {
          timestampBlocks.push(blockNumber);
          return 1_700_000_000 + blockNumber;
        },
        async getEvents() {
          return { events: many };
        },
      }),
      scanArgs,
    );
    expect(entries).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(timestampBlocks).toHaveLength(MAX_HISTORY_ENTRIES);
  });

  test("returns an empty feed when no events touch the account", async () => {
    const entries = await collectTransactionHistory(
      fakeRpc({
        async getEvents() {
          return {
            events: [
              {
                block_number: 1,
                data: ["9", "0"],
                keys: [TRANSFER_EVENT_KEY, OTHER, OTHER],
                transaction_hash: "0xnope",
              },
            ],
          };
        },
      }),
      scanArgs,
    );
    expect(entries).toEqual([]);
  });

  test("drops a transfer whose block timestamp cannot be read", async () => {
    const entries = await collectTransactionHistory(
      fakeRpc({
        async getBlockTimestamp() {
          return null;
        },
      }),
      scanArgs,
    );
    expect(entries).toEqual([]);
  });

  test("propagates a transport failure so the caller can degrade", async () => {
    await expect(
      collectTransactionHistory(
        fakeRpc({
          async getEvents() {
            throw new Error("fetch failed");
          },
        }),
        scanArgs,
      ),
    ).rejects.toThrow("fetch failed");
  });

  test("skips a token whose events fail with a semantic (non-transport) error", async () => {
    const semantic = Object.assign(new Error("contract not found"), {
      baseError: { code: 20 },
    });
    const entries = await collectTransactionHistory(
      fakeRpc({
        async getEvents() {
          throw semantic;
        },
      }),
      scanArgs,
    );
    expect(entries).toEqual([]);
  });

  test("propagates a transport failure reading a block timestamp so the caller degrades", async () => {
    // A hostile/failing RPC that serves getEvents but errors on the block-header
    // read must NOT silently drop the row and present a truncated feed as
    // complete on-chain history — the transport error propagates like getEvents.
    await expect(
      collectTransactionHistory(
        fakeRpc({
          async getBlockTimestamp() {
            throw new Error("fetch failed");
          },
        }),
        scanArgs,
      ),
    ).rejects.toThrow("fetch failed");
  });
});

// Drives the production wrapper through an injected fake provider so the
// getBlockTimestamp adapter's transport-vs-absent handling is actually covered.
type FakeProvider = Pick<RpcProvider, "getBlockNumber" | "getBlockWithTxHashes" | "getEvents">;

const fakeProvider = (overrides: Partial<FakeProvider> = {}): RpcProvider =>
  ({
    async getBlockNumber() {
      return 500;
    },
    async getBlockWithTxHashes() {
      return { timestamp: 1_700_000_000 } as Awaited<
        ReturnType<RpcProvider["getBlockWithTxHashes"]>
      >;
    },
    async getEvents() {
      return { events: EVENTS } as Awaited<ReturnType<RpcProvider["getEvents"]>>;
    },
    ...overrides,
  }) as unknown as RpcProvider;

const scanProviderArgs = {
  account: ACCOUNT,
  accountId: `SN_MAIN:${ACCOUNT}`,
  networkId: "SN_MAIN" as const,
  rpcUrls: ["https://rpc.example"],
  tokens: [eth],
};

describe("scanTransactionHistory block-timestamp degradation", () => {
  test("a block-timestamp transport error surfaces as history unavailable, not a shortened feed", async () => {
    await expect(
      scanTransactionHistory(scanProviderArgs, () =>
        fakeProvider({
          async getBlockWithTxHashes() {
            throw new Error("fetch failed");
          },
        }),
      ),
    ).rejects.toThrow("fetch failed");
  });

  test("a header genuinely without a timestamp drops only that row", async () => {
    const entries = await scanTransactionHistory(scanProviderArgs, () =>
      fakeProvider({
        async getBlockWithTxHashes() {
          return {} as Awaited<ReturnType<RpcProvider["getBlockWithTxHashes"]>>;
        },
      }),
    );
    expect(entries).toEqual([]);
  });
});
