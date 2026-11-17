/**
 * Gateway balance and transfer adapter checks for wallet-facing data.
 */
import { describe, expect, test } from "bun:test";
import { resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import { createStarkscanClient } from "@bramble/transactions/starkscan";
import {
  createExplorerFirstHistory,
  createRpcFirstBalances,
  getStarkscanTokenBalances,
  getStarkscanTransactionHistory,
} from "@bramble/transactions/starkscan-wallet";
import type { ExplorerLanePreferences, TokenConfig } from "@bramble/wallet-model/preferences";
import type { RpcProvider } from "starknet";

// The lane-bearing half of the stored defaults: no per-network opt-out and no
// rpcOverride, so the explorer lane is permitted and these cases exercise the
// fallback itself rather than the gate. Spelled out here rather than read from
// the settings store so this feature package keeps its own dependency surface.
const readPreferences = async (): Promise<ExplorerLanePreferences> => ({
  explorerFallback: {},
  rpcOverrides: {},
});

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

const balanceReply = (balanceRaw: string, tokenAddress = TOKEN) => ({
  balanceRaw,
  blockTag: "latest",
  chainId: "SN_MAIN",
  ownerAddress: ACCOUNT,
  tokenAddress,
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

  test("does not trust explorer display identity for untracked tokens", async () => {
    const transfer = {
      actionContext: null,
      amount: "1",
      blockNumber: 12,
      fromAddress: OTHER,
      logIndex: 1,
      rawValue: "1",
      sourceTier: "finalized",
      standard: "erc20",
      timestampIso: "2026-07-24T11:29:01.000Z",
      toAddress: ACCOUNT,
      tokenAddress: "0x123",
      tokenDecimals: 0,
      tokenId: null,
      tokenName: "Trusted-looking name",
      tokenSymbol: "ＵＳＤＣ",
      transferIndex: 0,
      txHash: "0x40f454",
      txIndex: 2,
    };
    const read = (tokenSymbol: string) =>
      getStarkscanTransactionHistory(
        clientFor({ items: [{ ...transfer, tokenSymbol }], nextCursor: null }),
        {
          account: ACCOUNT,
          accountId: `SN_MAIN:${ACCOUNT}`,
          networkId: "SN_MAIN",
          rpcUrls: ["https://rpc.example"],
          tokens: [],
        },
      );

    const [entry] = await read("FAKE");
    expect(entry?.summary).toBe("Received 1 TOKEN from 0x1176…f3d8");
    expect(entry?.summary).not.toContain(transfer.tokenName);
    expect(entry?.summary).not.toContain("FAKE");
  });

  test("reads each tracked token's latest balance, never the retired holdings route", async () => {
    const second: TokenConfig = {
      ...strk,
      address: "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
      id: "SN_MAIN:ETH:0x49d",
      name: "Ether",
      symbol: "ETH",
    };
    const urls: string[] = [];
    const client = createStarkscanClient({
      baseUrl: "https://starkscan.test/v1",
      http: async (url) => {
        urls.push(url);
        return new Response(
          JSON.stringify(
            url.includes(`/token/${TOKEN}/`)
              ? balanceReply("1023561579571385199213")
              : balanceReply("0", second.address),
          ),
        );
      },
    });
    const balances = await getStarkscanTokenBalances(client, {
      accountAddress: ACCOUNT,
      rpcUrls: ["https://rpc.example"],
      tokens: [strk, second],
    });
    expect(balances.map(({ balance, symbol }) => [symbol, balance])).toEqual([
      ["STRK", "1023561579571385199213"],
      ["ETH", "0"],
    ]);
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.includes("/balance-of/"))).toBe(true);
    expect(urls.some((url) => url.includes("token-holdings"))).toBe(false);
  });

  test("refuses an answer for another owner, token or block", async () => {
    const input = { accountAddress: ACCOUNT, rpcUrls: ["https://rpc.example"], tokens: [strk] };
    for (const reply of [
      { ...balanceReply("1"), ownerAddress: OTHER },
      balanceReply("1", OTHER),
      { ...balanceReply("1"), blockTag: "0x1" },
      { ...balanceReply("1"), chainId: "SN_SEPOLIA" },
    ]) {
      await expect(getStarkscanTokenBalances(clientFor(reply), input)).rejects.toThrow(
        "does not match",
      );
    }
  });

  // Ordering is pinned in starkscan-rpc-first.test.ts (balances, MCW-V09-129)
  // and starkscan-history-first.test.ts (history): balances ask the configured
  // RPC first with the gateway as the outage fallback; history asks the gateway
  // first with the RPC scan as the fallback. This case keeps the fallback wiring
  // itself covered in both directions — an unreachable gateway must not turn an
  // RPC outage into a thrown balance read, nor an RPC-answerable history read
  // into a thrown one.
  test("preferred wallet reads keep the indexed fallback wired", async () => {
    const input = {
      accountAddress: ACCOUNT,
      rpcUrls: ["https://rpc.example"],
      tokens: [strk],
    } as const;
    const complete = clientFor(balanceReply("0"));
    const offlineRpc = () =>
      ({
        async callContract() {
          throw new Error("node unreachable");
        },
      }) as unknown as RpcProvider;
    expect(
      (await createRpcFirstBalances({ client: complete, readPreferences })(input, offlineRpc))[0]
        ?.balance,
    ).toBe("0");
    resetRpcEndpointCooldownsForTests();

    let rpcBalanceReads = 0;
    const unavailable = createStarkscanClient({
      baseUrl: "https://starkscan.test/v1",
      http: async () => {
        throw new Error("offline");
      },
    });
    const balances = await createRpcFirstBalances({ client: unavailable, readPreferences })(
      input,
      () => {
        return {
          async callContract() {
            rpcBalanceReads += 1;
            return ["0x2", "0x0"];
          },
        } as unknown as RpcProvider;
      },
    );
    expect(balances[0]?.balance).toBe("2");
    expect(rpcBalanceReads).toBe(1);

    const historyInput = {
      account: ACCOUNT,
      accountId: `SN_MAIN:${ACCOUNT}`,
      networkId: "SN_MAIN",
      rpcUrls: ["https://rpc.example"],
      tokens: [],
    } as const;
    expect(
      await createExplorerFirstHistory({ client: unavailable, readPreferences })(historyInput),
    ).toEqual({ entries: [], lane: "chain-events" });
  });

  test("uses the configured explorer API only after an RPC transport outage", async () => {
    resetRpcEndpointCooldownsForTests();
    const input = {
      accountAddress: ACCOUNT,
      rpcUrls: ["https://custom-rpc.example"],
      tokens: [strk],
    } as const;
    const preferences: ExplorerLanePreferences = {
      explorerApiUrls: { SN_MAIN: "https://explorer.example/v1" },
      explorerFallback: { SN_MAIN: true },
      rpcOverrides: { SN_MAIN: "https://custom-rpc.example" },
    };
    const selected = clientFor(balanceReply("0"));
    const selections: string[] = [];
    const balances = await createRpcFirstBalances({
      client: clientFor({}),
      clientFor: (networkId, current) => {
        selections.push(`${networkId}:${current.explorerApiUrls?.[networkId]}`);
        return selected;
      },
      readPreferences: async () => preferences,
    })(input, () => {
      return {
        async callContract() {
          throw new Error("node unreachable");
        },
      } as unknown as RpcProvider;
    });

    expect(balances[0]?.balance).toBe("0");
    expect(selections).toEqual(["SN_MAIN:https://explorer.example/v1"]);
  });
});
