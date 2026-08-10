/** Public token and pool-fee affordability checks for account-mode privacy operations. */
import { describe, expect, test } from "bun:test";
import { assertPublicPoolSpendAffordable } from "../../src/background/strk20-op-context";
import { STRK_TOKEN_ADDRESS, sameFelt } from "../../src/starknet/networks";
import { defaultWalletPreferences } from "../../src/storage/preferences-store";
import { account } from "../support/background-wallet-stub";

const preferences = defaultWalletPreferences();
const eth = preferences.tokens.find(
  (token) => token.networkId === account.networkId && !sameFelt(token.address, STRK_TOKEN_ADDRESS),
);
const strk = preferences.tokens.find(
  (token) => token.networkId === account.networkId && sameFelt(token.address, STRK_TOKEN_ADDRESS),
);
if (!eth || !strk) {
  throw new Error("public affordability fixtures missing");
}

const contextFor = (token: typeof eth) =>
  ({
    accountContext: { account, rpcUrls: ["https://rpc.example"] },
    preferences,
    token,
  }) as never;

const depsWith = (balances: Readonly<Record<string, string>>) =>
  ({
    runtimeRpc: {
      async getTokenBalances({ tokens }: { readonly tokens: readonly (typeof eth)[] }) {
        return tokens.flatMap((token) => {
          const balance = Object.entries(balances).find(([address]) =>
            sameFelt(address, token.address),
          )?.[1];
          return balance === undefined ? [] : [{ ...token, balance, formatted: balance }];
        });
      },
    },
  }) as never;

describe("STRK20 public affordability", () => {
  test("requires the reviewed registration fee in public STRK", async () => {
    await expect(
      assertPublicPoolSpendAffordable(
        depsWith({ [STRK_TOKEN_ADDRESS]: "0" }),
        contextFor(eth),
        "0x1",
      ),
    ).rejects.toThrow("Not enough STRK for the pool fee");
  });

  test("checks a non-STRK deposit and its STRK fee separately", async () => {
    await expect(
      assertPublicPoolSpendAffordable(
        depsWith({ [eth.address]: "5", [STRK_TOKEN_ADDRESS]: "1" }),
        contextFor(eth),
        "0x2",
        "0x5",
      ),
    ).rejects.toThrow("Not enough STRK for the pool fee");
  });

  test("adds the fee to a STRK deposit instead of checking either in isolation", async () => {
    await expect(
      assertPublicPoolSpendAffordable(
        depsWith({ [STRK_TOKEN_ADDRESS]: "5" }),
        contextFor(strk),
        "0x1",
        "0x5",
      ),
    ).rejects.toThrow("Not enough STRK for the amount and pool fee");
  });
});
