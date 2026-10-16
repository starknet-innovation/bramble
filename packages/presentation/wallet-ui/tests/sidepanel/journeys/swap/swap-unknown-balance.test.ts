/**
 * Swap shows an unknown balance as "—", never as 0 (#680). A balance the
 * wallet could not read is not an empty one.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { TokenConfig, WalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import { DEFAULT_TOKENS } from "@bramble/wallet-model/networks";
import type { TokenBalance, WalletStatus } from "../../../../src/popup/responses/responses";
import { createSwapClient } from "../../../../src/sidepanel/journeys/swap/swap-client";
import { bindSwap } from "../../../../src/sidepanel/journeys/swap/swap-ui";
import { swapFlow } from "../../../../src/sidepanel/journeys/swap/swap-views";
import type { BalanceState, SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { flush, paint } from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const tokens: readonly TokenConfig[] = DEFAULT_TOKENS.filter(
  (token) => token.networkId === "SN_MAIN" && (token.symbol === "ETH" || token.symbol === "STRK"),
).map((token) => ({ ...token, id: `SN_MAIN:${token.symbol}:${token.address}` }));
const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens,
};
const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const balanceOf = (token: TokenConfig, formatted: string): TokenBalance => ({
  address: token.address,
  balance: formatted === "" ? "" : `${BigInt(formatted) * 10n ** 18n}`,
  decimals: 18,
  formatted,
  id: token.id,
  name: token.name,
  networkId: "SN_MAIN",
  symbol: token.symbol,
});

const mount = async (state: BalanceState) => {
  const app = document.createElement("div");
  app.id = "app";
  paint(app, swapFlow(status, account));
  document.body.append(app);
  bindSwap({
    app,
    balances: () => state,
    currency: () => "usd",
    navigateActivity: () => undefined,
    navigateHome: () => undefined,
    preferences: () => preferences,
    render: async () => undefined,
    status: () => status,
    swap: createSwapClient({ sendMessage: async () => ({ error: "no quote in this test" }) }),
    wallet: {} as unknown as SidepanelWallet,
  });
  await flush();
  return {
    buy: app.querySelector("#swap-buy-balance")?.textContent,
    sell: app.querySelector("#swap-sell-balance")?.textContent,
  };
};

describe("swap balances", () => {
  test("an unread balance shows the unknown marker on both sides", async () => {
    expect(await mount({ balances: [] })).toEqual({ buy: "—", sell: "—" });
  });

  test("an empty formatted balance is unknown too", async () => {
    expect(await mount({ balances: tokens.map((token) => balanceOf(token, "")) })).toEqual({
      buy: "—",
      sell: "—",
    });
  });

  test("a real zero still reads 0", async () => {
    expect(await mount({ balances: tokens.map((token) => balanceOf(token, "0")) })).toEqual({
      buy: "0",
      sell: "0",
    });
  });
});
