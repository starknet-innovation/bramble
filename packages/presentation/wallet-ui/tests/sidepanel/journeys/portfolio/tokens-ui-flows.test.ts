/**
 * The token management bindings driven through real DOM events: adding by
 * contract, scanning for held tokens and adding a find, and the show/hide
 * toggle. Each writes through the wallet, repaints on success, and reports a
 * refusal in the active UI language without repainting.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import { DEFAULT_TOKENS } from "@bramble/wallet-model/networks";
import { setUiLocale } from "../../../../src/i18n/locale";
import type { TokenBalance, WalletStatus } from "../../../../src/popup/responses/responses";
import {
  tokenAddFlow,
  tokenDiscoverFlow,
  tokensFlow,
} from "../../../../src/sidepanel/journeys/portfolio/token-flows";
import { bindTokens } from "../../../../src/sidepanel/journeys/portfolio/tokens-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
afterEach(() => setUiLocale("en"));

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

const tokens = DEFAULT_TOKENS.filter((token) => token.networkId === "SN_MAIN").map((token) => ({
  ...token,
  id: `SN_MAIN:${token.symbol}:${token.address}`,
}));
const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  hiddenTokens: [],
  schemaVersion: 1,
  tokens,
};

const found: TokenBalance = {
  address: "0x0abc",
  balance: "0x1",
  decimals: 18,
  formatted: "1",
  id: "SN_MAIN:ABC:0x0abc",
  name: "Abc",
  networkId: "SN_MAIN",
  symbol: "ABC",
};

const settle = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

const mount = (html: string, wallet: Partial<SidepanelWallet>) => {
  const app = document.createElement("div");
  app.innerHTML = html;
  document.body.replaceChildren(app);
  const renders: WalletStatus[] = [];
  bindTokens({
    app,
    openToken: () => undefined,
    refresh: async () => status,
    render: async (next) => {
      renders.push(next);
    },
    wallet: wallet as SidepanelWallet,
  });
  return { app, renders };
};

describe("token management bindings", () => {
  test("adds a token by contract and repaints", async () => {
    const added: string[] = [];
    const { app, renders } = mount(tokenAddFlow(status), {
      addToken: async (address: string) => {
        added.push(address);
      },
    });
    const form = app.querySelector<HTMLFormElement>("#token-add-form");
    const input = form?.querySelector<HTMLInputElement>('input[name="address"]');
    if (input) input.value = "0x0abc";
    form?.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(added).toHaveLength(1);
    expect(renders).toHaveLength(1);
  });

  test("a refused add reports in the UI language and does not repaint", async () => {
    setUiLocale("zh-Hans");
    const { app, renders } = mount(tokenAddFlow(status), {
      // A rejection that is not an Error falls back to the binding's own line.
      addToken: () => Promise.reject("refused"),
    });
    app
      .querySelector<HTMLFormElement>("#token-add-form")
      ?.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(app.querySelector("#token-add-result")?.textContent).toContain("添加代币失败");
    expect(renders).toHaveLength(0);
  });

  test("a scan lists its finds, and adding one repaints", async () => {
    setUiLocale("zh-Hans");
    const added: string[] = [];
    const { app, renders } = mount(tokenDiscoverFlow(status), {
      addToken: async (address: string) => {
        added.push(address);
      },
      detectTokens: async () => [found],
    });
    app.querySelector<HTMLButtonElement>("#detect-tokens")?.click();
    await settle();
    expect(app.querySelector("#detect-result")?.textContent).toBe("发现 1 个。");
    app.querySelector<HTMLButtonElement>('[data-detect-add="0x0abc"]')?.click();
    await settle();
    expect(added).toEqual(["0x0abc"]);
    expect(renders).toHaveLength(1);
  });

  test("an empty scan and a failed scan each say so", async () => {
    setUiLocale("zh-Hans");
    const empty = mount(tokenDiscoverFlow(status), { detectTokens: async () => [] });
    empty.app.querySelector<HTMLButtonElement>("#detect-tokens")?.click();
    await settle();
    expect(empty.app.querySelector("#detect-result")?.textContent).toBe("没有发现新代币。");
    expect(empty.app.querySelector("#detect-results")?.textContent).toContain(
      "此账户中没有发现新代币。",
    );

    const failed = mount(tokenDiscoverFlow(status), {
      detectTokens: () => Promise.reject("refused"),
    });
    failed.app.querySelector<HTMLButtonElement>("#detect-tokens")?.click();
    await settle();
    expect(failed.app.querySelector("#detect-result")?.textContent).toContain("代币检测失败");
  });

  test("hiding a token writes the flipped visibility and repaints", async () => {
    const writes: Array<readonly [string, boolean]> = [];
    const { app, renders } = mount(tokensFlow(status, preferences, [], {}, "usd"), {
      setTokenHidden: async (tokenId: string, hidden: boolean) => {
        writes.push([tokenId, hidden]);
      },
    } as unknown as Partial<SidepanelWallet>);
    const toggle = app.querySelector<HTMLButtonElement>("[data-token-toggle]");
    toggle?.click();
    await settle();
    expect(writes).toEqual([[toggle?.dataset["tokenToggle"] ?? "", true]]);
    expect(renders).toHaveLength(1);
  });
});
