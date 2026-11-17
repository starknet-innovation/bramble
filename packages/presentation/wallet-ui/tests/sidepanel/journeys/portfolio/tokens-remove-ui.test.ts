/**
 * The tokens flow's Remove control, driven through the real bindings under
 * happy-dom: it is the user's way out of a token a dapp added (Sherlock audit
 * 134), so a click must reach `wallet.removeToken` with that row's id and
 * repaint, and a refusal must surface and re-enable the control.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TokenConfig, WalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import { DEFAULT_TOKENS } from "@bramble/wallet-model/networks";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { tokensFlow } from "../../../../src/sidepanel/journeys/portfolio/token-flows";
import { bindTokens } from "../../../../src/sidepanel/journeys/portfolio/tokens-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

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

const dappToken: TokenConfig = {
  address: "0xbadc0ffee",
  decimals: 18,
  id: "SN_MAIN:PRZ:0xbadc0ffee",
  name: "Prize Token",
  networkId: "SN_MAIN",
  symbol: "PRZ",
};

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  hiddenTokens: [],
  schemaVersion: 1,
  tokens: [
    ...DEFAULT_TOKENS.filter((token) => token.networkId === "SN_MAIN").map((token) => ({
      ...token,
      id: `SN_MAIN:${token.symbol}:${token.address}`,
    })),
    dappToken,
  ],
};

const mount = (removeToken: (tokenId: string) => Promise<void>) => {
  const app = document.createElement("div");
  app.innerHTML = tokensFlow(status, preferences, [], {}, "usd");
  document.body.replaceChildren(app);
  const renders: WalletStatus[] = [];
  bindTokens({
    app,
    openToken: () => undefined,
    refresh: async () => status,
    render: async (next) => {
      renders.push(next);
    },
    wallet: { removeToken } as unknown as SidepanelWallet,
  });
  const button = app.querySelector<HTMLButtonElement>(`[data-token-remove="${dappToken.id}"]`);
  return { app, button, renders };
};

const settle = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

describe("tokens flow Remove", () => {
  test("sends the row's token id and repaints", async () => {
    const removed: string[] = [];
    const { button, renders } = mount(async (tokenId) => {
      removed.push(tokenId);
    });
    button?.click();
    await settle();
    expect(removed).toEqual([dappToken.id]);
    expect(renders).toHaveLength(1);
  });

  test("shows the refusal and re-enables the control", async () => {
    const { button, renders } = mount(async () => {
      throw new Error("Built-in tokens can't be removed");
    });
    button?.click();
    await settle();
    expect(renders).toHaveLength(0);
    expect(button?.disabled).toBe(false);
    expect(document.body.textContent).toContain("Built-in tokens can't be removed");
  });
});
