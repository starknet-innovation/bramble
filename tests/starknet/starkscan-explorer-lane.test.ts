/**
 * MCW-V09-129: the explorer gateway lane is opt-in, not merely last-resort.
 *
 * The trust ordering (RPC first, gateway only after every configured endpoint
 * fails, RPC failure re-thrown) is pinned by ./starkscan-rpc-first.test.ts.
 * These cases pin the permission on top of it: who gets the outage rescue by
 * default, who does not, and that an explicit choice overrides the default in
 * both directions. Every case drives a *failing* RPC, so a gateway that is
 * never contacted here is a gateway the wallet refused to contact.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences, type WalletPreferences } from "@mc-wallet/settings/preferences";
import {
  createStarkscanClient,
  type StarkscanClient,
  type StarkscanHttp,
} from "@mc-wallet/transactions/starkscan";
import {
  createRpcFirstBalances,
  createRpcFirstHistory,
} from "@mc-wallet/transactions/starkscan-wallet";
import type { TokenConfig } from "@mc-wallet/wallet-model/preferences";
import type { RpcProvider } from "starknet";

const ACCOUNT = "0x6c16710431efd3962d3c6f55faf00d8c855188029acb42781b9ac77c438ade5";
const OTHER = "0x1176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8";
const TOKEN = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const MY_NODE = "https://my-node.example/rpc";

const strk: TokenConfig = {
  address: TOKEN,
  decimals: 18,
  id: `SN_MAIN:STRK:${TOKEN}`,
  name: "Starknet Token",
  networkId: "SN_MAIN",
  symbol: "STRK",
};
const balanceInput = { accountAddress: ACCOUNT, rpcUrls: [MY_NODE], tokens: [strk] } as const;
const historyInput = {
  account: ACCOUNT,
  accountId: `SN_MAIN:${ACCOUNT}`,
  networkId: "SN_MAIN",
  rpcUrls: [MY_NODE],
  tokens: [strk],
} as const;

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

// Records every URL the gateway is asked for, so "did a third party learn this
// address?" is a direct assertion rather than an inference from the result.
const gateway = (body: unknown) => {
  const urls: string[] = [];
  const http: StarkscanHttp = async (url) => {
    urls.push(url);
    return new Response(JSON.stringify(body));
  };
  return { client: createStarkscanClient({ baseUrl: "https://starkscan.test/v1", http }), urls };
};

const failingRpc = () =>
  ({
    async callContract() {
      throw new Error("node unreachable");
    },
    async getBlockNumber() {
      throw new Error("node unreachable");
    },
  }) as unknown as RpcProvider;

const preferences = (overrides: Partial<WalletPreferences>): WalletPreferences => ({
  ...defaultWalletPreferences(),
  ...overrides,
});

const balancesWith = (prefs: WalletPreferences, client: StarkscanClient) =>
  createRpcFirstBalances({ client, readPreferences: async () => prefs });

describe("explorer gateway lane is opt-in per network", () => {
  test("built-in RPCs keep the outage rescue with no stored choice", async () => {
    const explorer = gateway(holdingsBody);
    const balances = await balancesWith(preferences({}), explorer.client)(balanceInput, failingRpc);

    expect(balances[0]?.balance).toBe("77");
    expect(explorer.urls).toHaveLength(1);
  });

  test("a configured rpcOverride refuses the lane and surfaces the RPC failure", async () => {
    const explorer = gateway(holdingsBody);
    const prefs = preferences({ rpcOverrides: { SN_MAIN: MY_NODE } });

    await expect(balancesWith(prefs, explorer.client)(balanceInput, failingRpc)).rejects.toThrow(
      "node unreachable",
    );
    expect(explorer.urls).toEqual([]);
  });

  test("an override user who opts back in gets the lane again", async () => {
    const explorer = gateway(holdingsBody);
    const prefs = preferences({
      explorerFallback: { SN_MAIN: true },
      rpcOverrides: { SN_MAIN: MY_NODE },
    });

    const balances = await balancesWith(prefs, explorer.client)(balanceInput, failingRpc);

    expect(balances[0]?.balance).toBe("77");
    expect(explorer.urls).toHaveLength(1);
  });

  test("a built-in-RPC user who opts out is never disclosed to the gateway", async () => {
    const explorer = gateway(holdingsBody);
    const prefs = preferences({ explorerFallback: { SN_MAIN: false } });

    await expect(balancesWith(prefs, explorer.client)(balanceInput, failingRpc)).rejects.toThrow(
      "node unreachable",
    );
    expect(explorer.urls).toEqual([]);
  });

  test("the choice is per network: Sepolia's override does not gate Mainnet", async () => {
    const explorer = gateway(holdingsBody);
    const prefs = preferences({ rpcOverrides: { SN_SEPOLIA: MY_NODE } });

    const balances = await balancesWith(prefs, explorer.client)(balanceInput, failingRpc);

    expect(balances[0]?.balance).toBe("77");
    expect(explorer.urls).toHaveLength(1);
  });

  test("a preferences read that throws fails closed rather than open", async () => {
    const explorer = gateway(holdingsBody);
    const balances = createRpcFirstBalances({
      client: explorer.client,
      readPreferences: async () => {
        throw new Error("preferences unavailable");
      },
    });

    await expect(balances(balanceInput, failingRpc)).rejects.toThrow("node unreachable");
    expect(explorer.urls).toEqual([]);
  });

  test("history obeys the same refusal and keeps the RPC failure", async () => {
    const explorer = gateway(transfersBody);
    const history = createRpcFirstHistory({
      client: explorer.client,
      readPreferences: async () => preferences({ rpcOverrides: { SN_MAIN: MY_NODE } }),
    });

    await expect(history(historyInput, failingRpc)).rejects.toThrow("node unreachable");
    expect(explorer.urls).toEqual([]);
  });

  test("history still falls back for a permitted network", async () => {
    const explorer = gateway(transfersBody);
    const history = createRpcFirstHistory({
      client: explorer.client,
      readPreferences: async () =>
        preferences({
          explorerFallback: { SN_MAIN: true },
          rpcOverrides: { SN_MAIN: MY_NODE },
        }),
    });

    expect(await history(historyInput, failingRpc)).toHaveLength(1);
    expect(explorer.urls).toHaveLength(1);
  });
});
