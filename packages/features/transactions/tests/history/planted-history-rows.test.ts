/**
 * Audit #163 part A: history must not record events a third party can plant
 * for free. On OZ ERC20 tokens anyone may call `transfer_from(victim, L, 0)`
 * with no allowance, a lookalike L may send the victim 0, and any contract can
 * emit a `Transfer` naming the victim. Each would otherwise appear as a "Sent"
 * or "Received" row with a one-click copy of the attacker's lookalike address.
 */
import { describe, expect, test } from "bun:test";
import type { ActivityEntry } from "@bramble/transactions/activity";
import { createStarkscanClient } from "@bramble/transactions/starkscan";
import { getStarkscanTransactionHistory } from "@bramble/transactions/starkscan-wallet";
import {
  decodeTransferEvent,
  TRANSFER_EVENT_KEY,
  withoutPlantedRows,
} from "@bramble/transactions/tx-history";
import { collectTransactionHistory, type HistoryRpc } from "@bramble/transactions/tx-history-scan";
import type { TokenConfig } from "@bramble/wallet-model/preferences";

const ACCOUNT = "0x6c16710431efd3962d3c6f55faf00d8c855188029acb42781b9ac77c438ade5";
const LOOKALIKE = "0x1176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8";
const TOKEN = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const strk: TokenConfig = {
  address: TOKEN,
  decimals: 18,
  id: `SN_MAIN:STRK:${TOKEN}`,
  name: "Starknet Token",
  networkId: "SN_MAIN",
  symbol: "STRK",
};

const event = (from: string, to: string, amount: string, hash: string) => ({
  block_number: 10,
  data: [amount, "0"],
  keys: [TRANSFER_EVENT_KEY, from, to],
  transaction_hash: hash,
});

describe("RPC history lane", () => {
  test("a zero-amount transfer is dropped in both directions", () => {
    expect(decodeTransferEvent(event(ACCOUNT, LOOKALIKE, "0", "0x1"), ACCOUNT)).toBeNull();
    expect(decodeTransferEvent(event(LOOKALIKE, ACCOUNT, "0x0", "0x2"), ACCOUNT)).toBeNull();
    expect(decodeTransferEvent(event(ACCOUNT, LOOKALIKE, "1", "0x3"), ACCOUNT)?.direction).toBe(
      "out",
    );
  });

  test("a planted transfer_from(account, L, 0) never becomes a 'Sent 0' row", async () => {
    const rpc: HistoryRpc = {
      async getBlockTimestamp(blockNumber) {
        return 1_700_000_000 + blockNumber;
      },
      async getEvents() {
        return {
          events: [
            event(ACCOUNT, LOOKALIKE, "0", "0xbad"),
            event(LOOKALIKE, ACCOUNT, "0", "0xbad2"),
            event(ACCOUNT, LOOKALIKE, "5", "0x900d"),
          ],
        };
      },
      async getLatestBlockNumber() {
        return 500;
      },
    };
    const entries = await collectTransactionHistory(rpc, {
      account: ACCOUNT,
      accountId: `SN_MAIN:${ACCOUNT}`,
      networkId: "SN_MAIN",
      tokens: [strk],
    });
    expect(entries.map((entry) => entry.hash)).toEqual(["0x900d"]);
  });
});

const starkscanTransfer = (overrides: Record<string, unknown>) => ({
  actionContext: null,
  amount: "1000",
  blockNumber: 12,
  fromAddress: ACCOUNT,
  logIndex: 1,
  rawValue: "1000",
  sourceTier: "finalized",
  standard: "erc20",
  timestampIso: "2026-07-24T11:29:01.000Z",
  toAddress: LOOKALIKE,
  tokenAddress: TOKEN,
  tokenDecimals: 18,
  tokenId: null,
  tokenName: "Starknet Token",
  tokenSymbol: "STRK",
  transferIndex: 0,
  txHash: "0x40f454",
  txIndex: 2,
  ...overrides,
});

const readStarkscan = (items: readonly unknown[]) =>
  getStarkscanTransactionHistory(
    createStarkscanClient({
      baseUrl: "https://starkscan.test/v1",
      http: async () => new Response(JSON.stringify({ items, nextCursor: null })),
    }),
    {
      account: ACCOUNT,
      accountId: `SN_MAIN:${ACCOUNT}`,
      networkId: "SN_MAIN",
      rpcUrls: ["https://rpc.example"],
      tokens: [strk],
    },
  );

describe("Starkscan history lane", () => {
  test("zero-amount legs are dropped in both directions", async () => {
    const entries = await readStarkscan([
      starkscanTransfer({ amount: "0", rawValue: "0" }),
      starkscanTransfer({
        amount: "0",
        fromAddress: LOOKALIKE,
        rawValue: "0",
        toAddress: ACCOUNT,
        txHash: "0x41",
      }),
    ]);
    expect(entries).toEqual([]);
  });

  test("an outgoing leg of an untracked token is dropped", async () => {
    const entries = await readStarkscan([
      starkscanTransfer({ tokenAddress: "0x123", tokenDecimals: 0, tokenSymbol: "STRK" }),
    ]);
    expect(entries).toEqual([]);
  });

  test("an incoming untracked-token leg stays but offers no copyable counterparty", async () => {
    const [entry, ...rest] = await readStarkscan([
      starkscanTransfer({
        fromAddress: LOOKALIKE,
        toAddress: ACCOUNT,
        tokenAddress: "0x123",
        tokenDecimals: 0,
      }),
    ]);
    expect(rest).toEqual([]);
    expect(entry?.summary).toStartWith("Received 1000 TOKEN from");
    expect(entry?.counterparty).toBeUndefined();
  });

  test("a tracked non-zero transfer is kept with its counterparty", async () => {
    const [entry] = await readStarkscan([starkscanTransfer({})]);
    expect(entry?.counterparty).toBe(LOOKALIKE);
  });
});

describe("rows persisted before the filter", () => {
  const row = (overrides: Partial<ActivityEntry>): ActivityEntry => ({
    accountId: `SN_MAIN:${ACCOUNT}`,
    amount: "1",
    counterparty: LOOKALIKE,
    hash: "0x10",
    kind: "transfer",
    networkId: "SN_MAIN",
    status: "accepted",
    submittedAt: 1,
    summary: "Sent 1 STRK to 0x1176…f3d8",
    token: "STRK",
    ...overrides,
  });

  test("planted zero-value and outgoing untracked-token rows are dropped", () => {
    expect(withoutPlantedRows([row({ amount: "0" })])).toEqual([]);
    expect(withoutPlantedRows([row({ amount: "0", summary: "Received 0 STRK from x" })])).toEqual(
      [],
    );
    expect(withoutPlantedRows([row({ summary: "Sent 1 TOKEN to x", token: "TOKEN" })])).toEqual([]);
  });

  test("an incoming untracked-token row stays but loses its copyable counterparty", () => {
    const [kept] = withoutPlantedRows([
      row({ summary: "Received 5 TOKEN from x", token: "TOKEN" }),
    ]);
    expect(kept?.summary).toBe("Received 5 TOKEN from x");
    expect(kept?.counterparty).toBeUndefined();
  });

  test("wallet-recorded rows and genuine tracked transfers are untouched", () => {
    const own = row({ amount: "0", origin: "wallet" });
    const genuine = row({});
    const call = row({ amount: "0", kind: "invoke" });
    expect(withoutPlantedRows([own, genuine, call])).toEqual([own, genuine, call]);
  });
});
