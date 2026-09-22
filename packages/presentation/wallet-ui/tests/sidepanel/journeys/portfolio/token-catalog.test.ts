/**
 * The AVNU catalog screen: what it lists, what each row offers, and what it says
 * on a network AVNU publishes no catalog for.
 *
 * The list is a directory. Adding from it goes through the wallet's add-token
 * path, which reads the token's facts from the contract, so these tests assert
 * the screen passes an ADDRESS and never the catalog's own claims.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@bramble/settings/preferences";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import {
  bindTokenCatalog,
  resetTokenCatalogForTests,
} from "../../../../src/sidepanel/journeys/portfolio/token-catalog-ui";
import { tokenCatalogFlow } from "../../../../src/sidepanel/journeys/portfolio/token-catalog-view";
import type { SwapCatalogTokenView } from "../../../../src/sidepanel/journeys/swap/swap-client";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const DAI = "0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0efd20e6eb3";

const status: WalletStatus = {
  accountCount: 1,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const preferences = (hidden: readonly string[] = []): WalletPreferences =>
  ({
    activeNetworkId: "SN_MAIN",
    addressBook: [],
    hiddenTokens: [...hidden],
    schemaVersion: 1,
    tokens: [
      {
        address: USDC,
        decimals: 6,
        id: "SN_MAIN:USDC",
        name: "USD Coin",
        networkId: "SN_MAIN",
        symbol: "USDC",
      },
    ],
  }) as unknown as WalletPreferences;

const CATALOG: readonly SwapCatalogTokenView[] = [
  { address: USDC, decimals: 6, name: "USD Coin", symbol: "USDC" },
  { address: DAI, decimals: 18, name: "Dai Stablecoin", symbol: "DAI" },
];

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const mount = async (
  catalog: readonly SwapCatalogTokenView[] | Error = CATALOG,
  hidden: readonly string[] = [],
  networkId = "SN_MAIN",
): Promise<{ added: string[]; app: HTMLElement; toggled: [string, boolean][] }> => {
  const scoped = { ...status, networkId } as WalletStatus;
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.innerHTML = tokenCatalogFlow(scoped);
  document.body.append(app);
  const added: string[] = [];
  const toggled: [string, boolean][] = [];
  bindTokenCatalog({
    app,
    catalog: async () => {
      if (catalog instanceof Error) throw catalog;
      return catalog;
    },
    preferences: () => preferences(hidden),
    refresh: async () => scoped,
    render: async () => undefined,
    status: () => scoped,
    wallet: {
      addToken: async (address: string) => {
        added.push(address);
      },
      setTokenHidden: async (tokenId: string, hide: boolean) => {
        toggled.push([tokenId, hide]);
      },
    } as unknown as SidepanelWallet,
  });
  await flush();
  return { added, app, toggled };
};

const rows = (app: HTMLElement): readonly string[] =>
  [...app.querySelectorAll<HTMLElement>(".token-row")].map((row) =>
    (row.textContent ?? "").replace(/\s+/g, " ").trim(),
  );

describe("AVNU catalog screen", () => {
  beforeEach(() => {
    resetTokenCatalogForTests();
    document.body.replaceChildren();
  });

  test("offers Add for an untracked token and Hide for one already tracked", async () => {
    const { app } = await mount();

    expect(rows(app)).toEqual(["USDC USD Coin Hide", "DAI Dai Stablecoin Add"]);
    expect(app.querySelector("#token-catalog-result")?.textContent).toBe(
      "2 tokens verified by AVNU.",
    );
  });

  test("offers Show for a token the user hid", async () => {
    const { app } = await mount(CATALOG, ["SN_MAIN:USDC"]);

    expect(rows(app)[0]).toBe("USDC USD Coin Show");
  });

  test("adds by address, never by the catalog's own facts", async () => {
    const { added, app } = await mount();

    app.querySelector<HTMLButtonElement>("[data-catalog-add]")?.click();
    await flush();

    expect(added).toEqual([DAI]);
  });

  test("hides a tracked token through the wallet's own registry", async () => {
    const { app, toggled } = await mount();

    app.querySelector<HTMLButtonElement>("[data-catalog-toggle]")?.click();
    await flush();

    expect(toggled).toEqual([["SN_MAIN:USDC", true]]);
  });

  test("searches by ticker, name, and address", async () => {
    const { app } = await mount();
    const search = app.querySelector<HTMLInputElement>("#token-catalog-search");
    if (!search) throw new Error("no search field");

    search.value = "dai";
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(rows(app)).toEqual(["DAI Dai Stablecoin Add"]);
    expect(app.querySelector("#token-catalog-result")?.textContent).toBe("1 of 2 shown.");

    search.value = USDC;
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(rows(app)).toEqual(["USDC USD Coin Hide"]);
  });

  test("says AVNU lists nothing here rather than showing an empty screen", async () => {
    const { app } = await mount([], [], "SN_SEPOLIA");

    expect(rows(app)).toEqual([]);
    expect(app.querySelector("#token-catalog-result")?.textContent).toContain(
      "AVNU lists no tokens for this network",
    );
  });

  test("reports a catalog it could not read", async () => {
    const { app } = await mount(new Error("service offline"), [], "SN_DEVNET");

    expect(app.querySelector("#token-catalog-result")?.textContent).toBe("service offline");
  });
});
