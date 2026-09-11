/**
 * MCW-V09-129: balances must come from the user's configured RPC, with the
 * public explorer gateway reached only when those endpoints cannot answer.
 * These cases pin that the gateway sees no account address on a healthy
 * refresh, that it still rescues an RPC outage, and that a gateway failure never
 * masks the user's own endpoint failure. Transaction history runs the other way
 * round (explorer first, RPC scan as the keyless fallback) under the same
 * per-network permission; its ordering is pinned in
 * packages/features/transactions/tests/history/starkscan-history-first.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { StarkscanClient } from "@bramble/transactions/starkscan";
import { createStarkscanClient, type StarkscanHttp } from "@bramble/transactions/starkscan";
import { createRpcFirstBalances } from "@bramble/transactions/starkscan-wallet";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import type { RpcProvider } from "starknet";

// These cases cover a user on the built-in RPCs, whose explorer lane is
// permitted by default; tests/starknet/starkscan-explorer-lane.test.ts owns the
// preference itself.
const readPreferences = async () => defaultWalletPreferences();
const rpcFirstBalances = (client: StarkscanClient) =>
  createRpcFirstBalances({ client, readPreferences });

const ACCOUNT = "0x6c16710431efd3962d3c6f55faf00d8c855188029acb42781b9ac77c438ade5";
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

  // The counts above are satisfied by any wiring that eventually calls the
  // gateway. This one records both lanes into one ordered trace, so "RPC first"
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
    }) as unknown as RpcProvider;

  test("consults the gateway strictly after the balance RPC attempt", async () => {
    const trace: string[] = [];
    await rpcFirstBalances(traced(holdingsBody, trace))(balanceInput, () =>
      tracedFailingRpc(trace),
    );
    expect(trace).toEqual(["rpc", "gateway"]);
  });
});
