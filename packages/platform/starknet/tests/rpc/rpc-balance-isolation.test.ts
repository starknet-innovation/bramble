/**
 * Isolated balance reads (Sherlock audit 134): one token whose `balanceOf` reverts
 * must not hide every other balance on the network, while transport faults
 * still fail over and the default mode still fails closed.
 */
import { describe, expect, test } from "bun:test";
import { getTokenBalances } from "@bramble/starknet/rpc";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import type { RpcProvider } from "starknet";

const ACCOUNT_ADDRESS = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const BAD_ADDRESS = "0xbadc0ffee";

const token = (symbol: string, address: string): TokenConfig => ({
  address,
  decimals: 18,
  id: `SN_MAIN:${symbol}:${address}`,
  name: symbol,
  networkId: "SN_MAIN",
  symbol,
});

const TOKENS = [
  token("ETH", "0x1"),
  token("STRK", "0x2"),
  token("BAD", BAD_ADDRESS),
  token("USDC", "0x3"),
  token("WBTC", "0x4"),
];

const contractError = (): Error =>
  Object.assign(new Error("Contract error"), { baseError: { code: 40, message: "revert" } });

type Call = { readonly contractAddress: string };

const providerWith =
  (fail: (call: Call) => unknown, seen: string[] = []) =>
  (nodeUrl: string): RpcProvider =>
    ({
      callContract: async (call: Call) => {
        seen.push(`${nodeUrl}:${call.contractAddress}`);
        const failure = fail(call);
        if (failure !== undefined) {
          throw failure;
        }
        return ["0x1", "0x0"];
      },
    }) as unknown as RpcProvider;

const isBad = (call: Call): boolean => call.contractAddress === BAD_ADDRESS;

describe("getTokenBalances with isolateTokenFailures", () => {
  test("returns every other balance when one token's balanceOf reverts", async () => {
    const balances = await getTokenBalances(
      {
        accountAddress: ACCOUNT_ADDRESS,
        isolateTokenFailures: true,
        rpcUrls: ["https://rpc.example"],
        tokens: TOKENS,
      },
      providerWith((call) => (isBad(call) ? contractError() : undefined)),
    );
    expect(balances.map((balance) => balance.symbol)).toEqual(["ETH", "STRK", "USDC", "WBTC"]);
  });

  test("drops a token whose response does not decode", async () => {
    const balances = await getTokenBalances(
      {
        accountAddress: ACCOUNT_ADDRESS,
        isolateTokenFailures: true,
        rpcUrls: ["https://rpc.example"],
        tokens: TOKENS.slice(0, 3),
      },
      () =>
        ({
          callContract: async (call: Call) => (isBad(call) ? ["not-a-felt"] : ["0x1", "0x0"]),
        }) as unknown as RpcProvider,
    );
    expect(balances.map((balance) => balance.symbol)).toEqual(["ETH", "STRK"]);
  });

  test("a transport error still rejects so the next endpoint is tried", async () => {
    const failover: string[] = [];
    const recovered = await getTokenBalances(
      {
        accountAddress: ACCOUNT_ADDRESS,
        isolateTokenFailures: true,
        rpcUrls: ["https://down.example", "https://up.example"],
        tokens: TOKENS.slice(0, 2),
      },
      (nodeUrl) =>
        providerWith(
          () => (nodeUrl.includes("down") ? new TypeError("fetch failed") : undefined),
          failover,
        )(nodeUrl),
    );
    expect(recovered.map((balance) => balance.symbol)).toEqual(["ETH", "STRK"]);
    expect(failover.some((entry) => entry.startsWith("https://up.example"))).toBe(true);
  });

  test("throws when every token fails rather than reporting an empty portfolio", async () => {
    await expect(
      getTokenBalances(
        {
          accountAddress: ACCOUNT_ADDRESS,
          isolateTokenFailures: true,
          rpcUrls: ["https://rpc.example"],
          tokens: TOKENS.slice(0, 2),
        },
        providerWith(() => contractError()),
      ),
    ).rejects.toThrow("Contract error");
  });

  test("the default mode still rejects the whole read on one contract error", async () => {
    await expect(
      getTokenBalances(
        { accountAddress: ACCOUNT_ADDRESS, rpcUrls: ["https://rpc.example"], tokens: TOKENS },
        providerWith((call) => (isBad(call) ? contractError() : undefined)),
      ),
    ).rejects.toThrow("Contract error");
  });
});
