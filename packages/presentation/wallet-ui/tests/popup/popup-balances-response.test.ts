/** Account/network correlation tests for public balance response envelopes. */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import { isBalancesResponse } from "../../src/popup/responses";
import { account } from "../support/runtime-client-fixtures";

const token = defaultWalletPreferences().tokens.find(
  (candidate) => candidate.networkId === account.networkId,
);
if (!token) {
  throw new Error("Sepolia token fixture missing");
}
const balance = { ...token, balance: "100", formatted: "0.0000000000000001" };

describe("balance response scope", () => {
  test("rejects an account id from another network", () => {
    expect(
      isBalancesResponse({
        accountId: `SN_MAIN:${account.address}`,
        balances: [balance],
        networkId: account.networkId,
        ok: true,
      }),
    ).toBe(false);
  });

  test("rejects a token id from another network", () => {
    expect(
      isBalancesResponse({
        accountId: account.id,
        balances: [{ ...balance, id: `SN_MAIN:${token.symbol}:${token.address}` }],
        networkId: account.networkId,
        ok: true,
      }),
    ).toBe(false);
  });
});
