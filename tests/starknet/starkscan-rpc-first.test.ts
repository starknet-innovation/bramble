/**
 * MCW-V09-129: balances and history must come from the user's configured RPC,
 * with the public explorer gateway reached only when those endpoints cannot
 * answer. These cases pin that the gateway sees no account address on a healthy
 * refresh, that it still rescues an RPC outage, and that a gateway failure never
 * masks the user's own endpoint failure.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { StarkscanClient } from "@bramble/transactions/starkscan";
import { createStarkscanClient, type StarkscanHttp } from "@bramble/transactions/starkscan";
import {
  createRpcFirstBalances,
  createRpcFirstHistory,
} from "@bramble/transactions/starkscan-wallet";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import type { RpcProvider } from "starknet";

// These cases cover a user on the built-in RPCs, whose explorer lane is
// permitted by default; tests/starknet/starkscan-explorer-lane.test.ts owns the
// preference itself.
const readPreferences = async () => defaultWalletPreferences();
const rpcFirstBalances = (client: StarkscanClient) =>
  createRpcFirstBalances({ client, readPreferences });
const rpcFirstHistory = (client: StarkscanClient) =>
  createRpcFirstHistory({ client, readPreferences });

const ACCOUNT = "0x6c16710431efd3962d3c6f55faf00d8c855188029acb42781b9ac77c438ade5";
const OTHER = "0x1176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8";
const TOKEN = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const strk: TokenConfig = {
  address: TOKEN,
  decimals: 18,
  id: `SN_MAIN:STRK:${TOKEN}`,
  name: "Starknet Token",
  networkId: "SN_MAIN",
  symbol: "STRK",
};
const balanceInput = {
  accountAddress: ACCOUNT,
  rpcUrls: ["https://rpc.example"],
  tokens: [strk],
} as const;
const historyInput = {
  account: ACCOUNT,
  accountId: `SN_MAIN:${ACCOUNT}`,
  networkId: "SN_MAIN",
  rpcUrls: ["https://rpc.example"],
  tokens: [strk],
} as const;

// A gateway whose every request is recorded, so "was the third party told which
// address the user holds?" is directly observable.
const gateway = (body: unknown) => {
  const urls: string[] = [];
  const http: StarkscanHttp = async (url) => {
    urls.push(url);
    return new Response(JSON.stringify(body));
  };
  return { client: createStarkscanClient({ baseUrl: "https://starkscan.test/v1", http }), urls };
};

const holdingsBody = {
  chainId: "SN_MAIN",
  completeness: {
    cap: null,
    capped: false,
    complete: true,
    exact: true,
    lagBlocks: 0,
    reason: "Complete snapshot.",
    reasonCode: "complete",
    truncated: false,
  },
  exact: true,
  items: [
    {
      decimals: 18,
      indexedBalanceRaw: "77",
      name: "Starknet Token",
      normalizedTokenAddress: TOKEN,
      symbol: "STRK",
      tokenAddress: TOKEN,
    },
  ],
  ownerAddress: ACCOUNT,
  truncated: false,
};

const transfersBody = {
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
      txHash: "0x40f454",
      txIndex: 2,
    },
  ],
  nextCursor: null,
};

const workingBalanceRpc = (reads: string[]) =>
  ({
    async callContract() {
      reads.push("balanceOf");
      return ["0x2", "0x0"];
    },
  }) as unknown as RpcProvider;

const failingRpc = () =>
  ({
    async callContract() {
      throw new Error("node unreachable");
    },
    async getBlockNumber() {
      throw new Error("node unreachable");
    },
  }) as unknown as RpcProvider;

const workingHistoryRpc = () =>
  ({
    async getBlockNumber() {
      return 12_237_600;
    },
    async getEvents() {
      return { events: [] };
    },
  }) as unknown as RpcProvider;

describe("wallet reads prefer the configured RPC", () => {
  test("serves balances from RPC without disclosing the address to the gateway", async () => {
    const { client, urls } = gateway(holdingsBody);
    const reads: string[] = [];
    const balances = await rpcFirstBalances(client)(balanceInput, () => workingBalanceRpc(reads));
    expect(balances[0]?.balance).toBe("2");
    expect(reads).toEqual(["balanceOf"]);
    expect(urls).toEqual([]);
  });

  test("falls back to the gateway only when the configured endpoints fail", async () => {
    const { client, urls } = gateway(holdingsBody);
    const balances = await rpcFirstBalances(client)(balanceInput, failingRpc);
    expect(balances[0]?.balance).toBe("77");
    expect(urls).toHaveLength(1);
  });

  test("does not disclose the address after a semantic RPC failure", async () => {
    const { client, urls } = gateway(holdingsBody);
    await expect(
      rpcFirstBalances(client)(
        balanceInput,
        () =>
          ({
            async callContract() {
              throw new WalletError("Invalid token balance response");
            },
          }) as unknown as RpcProvider,
      ),
    ).rejects.toThrow("Invalid token balance response");
    expect(urls).toEqual([]);
  });

  test("reports the RPC failure, not the gateway's, when neither answers", async () => {
    const { client } = gateway({ items: "not-a-snapshot" });
    await expect(rpcFirstBalances(client)(balanceInput, failingRpc)).rejects.toThrow(
      "node unreachable",
    );
  });

  test("scans history over RPC without disclosing the address to the gateway", async () => {
    const { client, urls } = gateway(transfersBody);
    expect(await rpcFirstHistory(client)(historyInput, workingHistoryRpc)).toEqual([]);
    expect(urls).toEqual([]);
  });

  test("falls back to indexed transfers only when the RPC scan fails", async () => {
    const { client, urls } = gateway(transfersBody);
    const entries = await rpcFirstHistory(client)(historyInput, failingRpc);
    expect(entries).toHaveLength(1);
    expect(urls).toHaveLength(1);
  });

  // The counts above are satisfied by any wiring that eventually calls the
  // gateway. These two record both lanes into one ordered trace, so "RPC first"
  // is pinned as a sequence: a refactor that raced the sources (Promise.any, or
  // a warm-the-cache gateway call) would disclose the address before the user's
  // own endpoint had failed and shows up here as a reordered trace.
  const traced = (body: unknown, trace: string[]) => {
    const http: StarkscanHttp = async () => {
      trace.push("gateway");
      return new Response(JSON.stringify(body));
    };
    return createStarkscanClient({ baseUrl: "https://starkscan.test/v1", http });
  };
  const tracedFailingRpc = (trace: string[]) =>
    ({
      async callContract() {
        trace.push("rpc");
        throw new Error("node unreachable");
      },
      async getBlockNumber() {
        trace.push("rpc");
        throw new Error("node unreachable");
      },
    }) as unknown as RpcProvider;

  test("consults the gateway strictly after the balance RPC attempt", async () => {
    const trace: string[] = [];
    await rpcFirstBalances(traced(holdingsBody, trace))(balanceInput, () =>
      tracedFailingRpc(trace),
    );
    expect(trace).toEqual(["rpc", "gateway"]);
  });

  test("consults the gateway strictly after the history RPC scan", async () => {
    const trace: string[] = [];
    await rpcFirstHistory(traced(transfersBody, trace))(historyInput, () =>
      tracedFailingRpc(trace),
    );
    expect(trace).toEqual(["rpc", "gateway"]);
  });
});
