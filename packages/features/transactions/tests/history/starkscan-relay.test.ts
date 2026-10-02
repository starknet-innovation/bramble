/**
 * Relay discovery boundary checks: a SNIP-9 outside execution is recognised from
 * the indexed transaction detail (never from a transfer event), both revisions
 * decode, a page-capped scan stays bounded, and a degraded summary source never
 * hides the transfer rows.
 */
import { describe, expect, test } from "bun:test";
import { createStarkscanClient } from "@bramble/transactions/starkscan";
import {
  decodeOutsideExecution,
  discoverSnip9Executions,
  EXECUTE_FROM_OUTSIDE_SELECTOR,
  EXECUTE_FROM_OUTSIDE_V2_SELECTOR,
} from "@bramble/transactions/starkscan-relay";
import { getStarkscanTransactionHistory } from "@bramble/transactions/starkscan-wallet";
import type { TokenConfig } from "@bramble/wallet-model/preferences";

const ACCOUNT = "0x6c16710431efd3962d3c6f55faf00d8c855188029acb42781b9ac77c438ade5";
const OTHER = "0x1176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8";
const TOKEN = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RELAY_HASH = "0xabc123";
const TRANSFER_HASH = "0x40f454";

const strk: TokenConfig = {
  address: TOKEN,
  decimals: 18,
  id: `SN_MAIN:STRK:${TOKEN}`,
  name: "Starknet Token",
  networkId: "SN_MAIN",
  symbol: "STRK",
};

const historyInput = {
  account: ACCOUNT,
  accountId: `SN_MAIN:${ACCOUNT}`,
  networkId: "SN_MAIN",
  rpcUrls: ["https://rpc.example"],
  tokens: [strk],
} as const;

// A well-formed SNIP-9 envelope: caller, nonce, execute_after, execute_before,
// then [call_count, (to, selector, calldata_len, calldata)*], then the signed
// response as [length, ...felts].
const outsideCalldata = (input: {
  readonly calls: number;
  readonly nonce: string;
  readonly signed?: number;
}): readonly string[] => {
  const words = ["0x0", input.nonce, "0x0", "0x0", `0x${input.calls.toString(16)}`];
  for (let call = 0; call < input.calls; call += 1) {
    words.push("0x111", "0x222", "0x1", "0x0");
  }
  const signed = input.signed ?? 2;
  words.push(`0x${signed.toString(16)}`);
  for (let index = 0; index < signed; index += 1) {
    words.push("0x1");
  }
  return words;
};

const detailBody = (input: {
  readonly calldata: readonly string[];
  readonly callSelector: string;
  readonly calldataLength?: number;
  readonly executionStatus?: string;
  readonly finalityStatus?: string;
  readonly fromAddress?: string;
  readonly to?: string;
  readonly txHash?: string;
}) => ({
  accountCalls: [
    {
      calldataLength: input.calldataLength ?? input.calldata.length,
      selector: input.callSelector,
      to: input.to ?? ACCOUNT,
    },
  ],
  blockNumber: 900,
  calldata: [...input.calldata],
  executionStatus: input.executionStatus ?? "SUCCEEDED",
  finalityStatus: input.finalityStatus ?? "ACCEPTED_ON_L2",
  fromAddress: input.fromAddress ?? OTHER,
  timestampIso: "2026-09-01T10:00:00.000Z",
  txHash: input.txHash ?? RELAY_HASH,
  txType: "INVOKE",
});

const summaryBody = (txHash: string, overrides: Record<string, unknown> = {}) => ({
  blockNumber: 900,
  counterparty: null,
  executionStatus: "SUCCEEDED",
  finalityStatus: "ACCEPTED_ON_L2",
  kinds: ["invoke"],
  operationKind: null,
  operationLabel: null,
  timestampIso: "2026-09-01T10:00:00.000Z",
  transferCount: 0,
  txHash,
  txIndex: 0,
  txType: "INVOKE",
  ...overrides,
});

const routedClient = (routes: {
  readonly detail?: (txHash: string) => unknown;
  readonly transactions?: (url: string) => unknown;
  readonly transfers?: unknown;
}) =>
  createStarkscanClient({
    baseUrl: "https://starkscan.test/v1",
    http: async (url) => {
      const marker = "/tx/";
      const at = url.indexOf(marker);
      if (at >= 0) {
        const txHash = url.slice(at + marker.length).split("?")[0] ?? "";
        return new Response(JSON.stringify(routes.detail?.(txHash)));
      }
      if (url.includes("/transactions")) {
        return new Response(JSON.stringify(routes.transactions?.(url)));
      }
      return new Response(JSON.stringify(routes.transfers ?? { items: [], nextCursor: null }));
    },
  });

const relayOnly = (input: {
  readonly callSelector: string;
  readonly calldata: readonly string[];
}) =>
  routedClient({
    detail: () => detailBody({ callSelector: input.callSelector, calldata: input.calldata }),
    transactions: () => ({ items: [summaryBody(RELAY_HASH)], nextCursor: null }),
  });

describe("SNIP-9 outside execution decoding", () => {
  test("reads a complete v2 envelope", () => {
    expect(decodeOutsideExecution(outsideCalldata({ calls: 1, nonce: "0x2a" }), "2")).toEqual({
      callCount: 1,
      caller: "0x0",
      nonce: "0x2a",
      revision: "2",
    });
  });

  test("rejects truncated envelopes", () => {
    const words = outsideCalldata({ calls: 1, nonce: "0x2a" });
    expect(decodeOutsideExecution(words.slice(0, 4), "2")).toBeNull();
    expect(decodeOutsideExecution([...words.slice(0, 7)], "1")).toBeNull();
    expect(decodeOutsideExecution(["0x0", "0x2a", "0x0", "0x0", "0x5"], "1")).toBeNull();
  });
});

describe("relayed SNIP-9 discovery", () => {
  test("records a v2 execution from the indexed transaction detail", async () => {
    const entries = await discoverSnip9Executions(
      relayOnly({
        calldata: outsideCalldata({ calls: 1, nonce: "0x2a" }),
        callSelector: EXECUTE_FROM_OUTSIDE_V2_SELECTOR,
      }),
      historyInput,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      counterparty: OTHER,
      hash: RELAY_HASH,
      kind: "invoke",
      origin: "relay",
      snip9: { callCount: 1, nonce: "0x2a", revision: "2" },
      status: "accepted",
      summary: "Relayed execution",
    });
    expect(entries[0]?.snip9?.messageHash).toBeUndefined();
    expect(entries[0]?.amount).toBeUndefined();
  });

  test("recognises the v1 selector and its nonce", async () => {
    const entries = await discoverSnip9Executions(
      relayOnly({
        calldata: outsideCalldata({ calls: 2, nonce: "0x7" }),
        callSelector: EXECUTE_FROM_OUTSIDE_SELECTOR,
      }),
      historyInput,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.snip9).toEqual({
      callCount: 2,
      caller: "0x0",
      nonce: "0x7",
      revision: "1",
    });
  });

  test("skips a reverted or unaccepted execution", async () => {
    const reverted = routedClient({
      detail: () =>
        detailBody({
          calldata: outsideCalldata({ calls: 1, nonce: "0x2a" }),
          callSelector: EXECUTE_FROM_OUTSIDE_V2_SELECTOR,
          executionStatus: "REVERTED",
        }),
      transactions: () => ({ items: [summaryBody(RELAY_HASH)], nextCursor: null }),
    });
    expect(await discoverSnip9Executions(reverted, historyInput)).toEqual([]);
  });

  test("skips a call aimed at another contract or an ordinary selector", async () => {
    const otherContract = routedClient({
      detail: () =>
        detailBody({
          calldata: outsideCalldata({ calls: 1, nonce: "0x2a" }),
          callSelector: EXECUTE_FROM_OUTSIDE_V2_SELECTOR,
          to: OTHER,
        }),
      transactions: () => ({ items: [summaryBody(RELAY_HASH)], nextCursor: null }),
    });
    expect(await discoverSnip9Executions(otherContract, historyInput)).toEqual([]);

    const ordinaryCall = routedClient({
      detail: () =>
        detailBody({
          calldata: outsideCalldata({ calls: 1, nonce: "0x2a" }),
          callSelector: "0xdead",
        }),
      transactions: () => ({ items: [summaryBody(RELAY_HASH)], nextCursor: null }),
    });
    expect(await discoverSnip9Executions(ordinaryCall, historyInput)).toEqual([]);
  });

  test("fails closed when the declared calldata length overruns the raw calldata", async () => {
    const overrun = routedClient({
      detail: () =>
        detailBody({
          calldata: outsideCalldata({ calls: 1, nonce: "0x2a" }),
          calldataLength: 99,
          callSelector: EXECUTE_FROM_OUTSIDE_V2_SELECTOR,
        }),
      transactions: () => ({ items: [summaryBody(RELAY_HASH)], nextCursor: null }),
    });
    expect(await discoverSnip9Executions(overrun, historyInput)).toEqual([]);
  });

  test("pages the summaries and caps the certified detail reads", async () => {
    const hashes = Array.from({ length: 9 }, (_, index) => `0x${(1000 - index).toString(16)}`);
    const firstPage = hashes
      .slice(0, 5)
      .map((hash, index) => summaryBody(hash, { blockNumber: 1000 - index }));
    const secondPage = hashes
      .slice(5)
      .map((hash, index) => summaryBody(hash, { blockNumber: 995 - index }));
    const client = routedClient({
      detail: (txHash) =>
        detailBody({
          calldata: outsideCalldata({ calls: 1, nonce: `0x${txHash.slice(2)}` }),
          callSelector: EXECUTE_FROM_OUTSIDE_V2_SELECTOR,
          txHash,
        }),
      transactions: (url) =>
        url.includes("cursor=c1")
          ? { items: secondPage, nextCursor: null }
          : { items: firstPage, nextCursor: "c1" },
    });

    const entries = await discoverSnip9Executions(client, historyInput);
    // Nine candidates, newest first; only the newest eight are fetched.
    expect(entries.map((entry) => entry.hash)).toEqual(hashes.slice(0, 8));
  });

  test("collapses repeated summaries for the same transaction", async () => {
    const client = routedClient({
      detail: () =>
        detailBody({
          calldata: outsideCalldata({ calls: 1, nonce: "0x2a" }),
          callSelector: EXECUTE_FROM_OUTSIDE_V2_SELECTOR,
        }),
      transactions: () => ({
        items: [summaryBody(RELAY_HASH), summaryBody(RELAY_HASH, { blockNumber: 899 })],
        nextCursor: null,
      }),
    });
    expect(await discoverSnip9Executions(client, historyInput)).toHaveLength(1);
  });

  test("devnet is never discoverable through Starkscan", async () => {
    const client = relayOnly({
      calldata: outsideCalldata({ calls: 1, nonce: "0x2a" }),
      callSelector: EXECUTE_FROM_OUTSIDE_V2_SELECTOR,
    });
    await expect(
      discoverSnip9Executions(client, {
        ...historyInput,
        accountId: `SN_DEVNET:${ACCOUNT}`,
        networkId: "SN_DEVNET",
      }),
    ).rejects.toThrow("devnet");
  });
});

describe("explorer-first history with relay discovery", () => {
  const transferBody = {
    items: [
      {
        actionContext: null,
        amount: "47053608819441904",
        blockNumber: 12_237_588,
        fromAddress: ACCOUNT,
        logIndex: 1,
        rawValue: "47053608819441904",
        sourceTier: "finalized",
        standard: "erc20",
        timestampIso: "2026-07-24T11:29:01.000Z",
        toAddress: OTHER,
        tokenAddress: TOKEN,
        tokenDecimals: 18,
        tokenId: null,
        tokenName: "Starknet Token",
        tokenSymbol: "STRK",
        transferIndex: 0,
        txHash: TRANSFER_HASH,
        txIndex: 2,
      },
    ],
    nextCursor: null,
  };

  test("keeps transfer rows beside a discovered execution", async () => {
    const client = routedClient({
      detail: () =>
        detailBody({
          calldata: outsideCalldata({ calls: 1, nonce: "0x2a" }),
          callSelector: EXECUTE_FROM_OUTSIDE_V2_SELECTOR,
        }),
      transactions: () => ({ items: [summaryBody(RELAY_HASH)], nextCursor: null }),
      transfers: transferBody,
    });

    const entries = await getStarkscanTransactionHistory(client, historyInput);
    expect(entries.map((entry) => entry.hash).sort()).toEqual([TRANSFER_HASH, RELAY_HASH].sort());
    expect(entries.find((entry) => entry.hash === RELAY_HASH)?.origin).toBe("relay");
    expect(entries.find((entry) => entry.hash === TRANSFER_HASH)?.kind).toBe("transfer");
  });

  test("a failing summary read still returns the transfer rows", async () => {
    const client = createStarkscanClient({
      baseUrl: "https://starkscan.test/v1",
      http: async (url) =>
        url.includes("/transactions")
          ? new Response("{}", { status: 503 })
          : new Response(JSON.stringify(transferBody)),
    });

    const entries = await getStarkscanTransactionHistory(client, historyInput);
    expect(entries.map((entry) => entry.hash)).toEqual([TRANSFER_HASH]);
  });
});

describe("certified detail boundary", () => {
  test("builds the tx route and rejects a malformed detail", async () => {
    const requested: string[] = [];
    const client = createStarkscanClient({
      baseUrl: "https://starkscan.test/v1",
      http: async (url) => {
        requested.push(url);
        return new Response(
          JSON.stringify({
            accountCalls: Array.from({ length: 65 }, () => ({
              calldataLength: 0,
              selector: null,
              to: ACCOUNT,
            })),
            blockNumber: 1,
            calldata: [],
            executionStatus: null,
            finalityStatus: null,
            fromAddress: null,
            timestampIso: "2026-09-01T10:00:00.000Z",
            txHash: RELAY_HASH,
            txType: null,
          }),
        );
      },
    });

    await expect(client.getTransactionDetail("SN_MAIN", RELAY_HASH)).rejects.toThrow(
      "Invalid Starkscan response",
    );
    expect(requested[0]).toBe(`https://starkscan.test/v1/SN_MAIN/tx/${RELAY_HASH}`);
  });
});
