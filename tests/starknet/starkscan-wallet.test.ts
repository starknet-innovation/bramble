/**
 * Indexed holdings and transfer adapter checks for wallet-facing data.
 */
import { describe, expect, test } from "bun:test";
import { createStarkscanClient } from "../../src/starknet/starkscan";
import {
  getStarkscanTokenBalances,
  getStarkscanTransactionHistory,
} from "../../src/starknet/starkscan-wallet";
import type { TokenConfig } from "../../src/storage/preferences-entries";

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

const clientFor = (value: unknown) =>
  createStarkscanClient({
    baseUrl: "https://starkscan.test/v1",
    http: async () => new Response(JSON.stringify(value)),
  });

describe("Starkscan wallet adapters", () => {
  test("turns indexed transfers into recent wallet activity", async () => {
    const client = clientFor({
      items: [
        {
          blockNumber: 12_237_588,
          timestampIso: "2026-07-24T11:29:01.000Z",
          txIndex: 2,
          logIndex: 1,
          transferIndex: 0,
          txHash: "0x40f454",
          tokenAddress: TOKEN,
          fromAddress: ACCOUNT,
          toAddress: OTHER,
          amount: "47053608819441904",
          rawValue: "47053608819441904",
          tokenId: null,
          standard: "erc20",
          tokenSymbol: "STRK",
          tokenName: "Starknet Token",
          tokenDecimals: 18,
          sourceTier: "finalized",
          actionContext: null,
        },
      ],
      nextCursor: null,
    });
    const entries = await getStarkscanTransactionHistory(client, {
      account: ACCOUNT,
      accountId: `SN_MAIN:${ACCOUNT}`,
      networkId: "SN_MAIN",
      rpcUrls: ["https://rpc.example"],
      tokens: [strk],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      amount: "0.047053608819441904",
      counterparty: OTHER,
      status: "accepted",
      summary: "Sent 0.047053608819441904 STRK to 0x1176…f3d8",
    });
  });

  test("maps a complete holdings snapshot and treats absent tracked tokens as zero", async () => {
    const second: TokenConfig = {
      ...strk,
      address: "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
      id: "SN_MAIN:ETH:0x49d",
      name: "Ether",
      symbol: "ETH",
    };
    const balances = await getStarkscanTokenBalances(
      clientFor({
        chainId: "SN_MAIN",
        ownerAddress: ACCOUNT,
        items: [
          {
            tokenAddress: TOKEN,
            normalizedTokenAddress: TOKEN,
            indexedBalanceRaw: "1023561579571385199213",
            symbol: "STRK",
            name: "Starknet Token",
            decimals: 18,
          },
        ],
        exact: true,
        truncated: false,
        completeness: {
          exact: true,
          truncated: false,
          complete: true,
          reasonCode: "complete",
          reason: "Complete snapshot.",
          lagBlocks: 0,
          capped: false,
          cap: null,
        },
      }),
      {
        accountAddress: ACCOUNT,
        rpcUrls: ["https://rpc.example"],
        tokens: [strk, second],
      },
    );
    expect(balances.map(({ balance, symbol }) => [symbol, balance])).toEqual([
      ["STRK", "1023561579571385199213"],
      ["ETH", "0"],
    ]);
  });

  test("rejects incomplete holdings so latest-state RPC can take over", async () => {
    await expect(
      getStarkscanTokenBalances(
        clientFor({
          chainId: "SN_MAIN",
          ownerAddress: ACCOUNT,
          items: [],
          exact: false,
          truncated: true,
          completeness: {
            exact: false,
            truncated: true,
            complete: false,
            reasonCode: "capped",
            reason: "Snapshot capped.",
            lagBlocks: 3,
            capped: true,
            cap: 100,
          },
        }),
        { accountAddress: ACCOUNT, rpcUrls: ["https://rpc.example"], tokens: [strk] },
      ),
    ).rejects.toThrow("incomplete");
  });
});
