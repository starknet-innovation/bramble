/**
 * scanTransactionHistory short-circuits on an empty token list: with nothing to
 * scan it returns an empty feed and never constructs a provider or touches RPC.
 */
import { describe, expect, test } from "bun:test";
import type { RpcProvider } from "starknet";
import { scanTransactionHistory } from "../../src/starknet/tx-history-scan";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

describe("scanTransactionHistory", () => {
  test("returns an empty feed without building a provider when no tokens are tracked", async () => {
    let providerBuilt = false;
    const makeProvider = (): RpcProvider => {
      providerBuilt = true;
      throw new Error("provider must not be built for an empty token list");
    };

    const entries = await scanTransactionHistory(
      {
        account: ACCOUNT,
        accountId: `SN_MAIN:${ACCOUNT}`,
        networkId: "SN_MAIN",
        rpcUrls: ["https://rpc.example"],
        tokens: [],
      },
      makeProvider,
    );

    expect(entries).toEqual([]);
    expect(providerBuilt).toBe(false);
  });
});
