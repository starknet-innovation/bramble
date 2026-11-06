/**
 * The Home NFTs tab (Derek, 2026-11-06): its panel shows the gallery content
 * inline in every state (NFTs as cards that open the detail screen, empty,
 * incomplete, unavailable), the tabs switch by click and keyboard, the card
 * actions have a real button shape, and the send summary stacks at side-panel
 * width so "Collection" never runs into its value.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { homeNftsPanel } from "../../../../src/sidepanel/journeys/collectibles/nft-home";
import {
  bindHomeTabs,
  type HomeTab,
  homeTabPanels,
} from "../../../../src/sidepanel/journeys/portfolio/home-tab-bar";
import { COMPONENT_STYLES } from "../../../../src/sidepanel/styles/core/styles-components";
import { JOURNEY_STYLES } from "../../../../src/sidepanel/styles/core/styles-journeys";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

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

const owned: DiscoveredNft = {
  collection: "Punks",
  contract: "0x511a2b3",
  id: "SN_MAIN:0x511a2b3:5",
  image: "",
  name: "Punk #5",
  networkId: "SN_MAIN",
  tokenId: "5",
};

const NONE_FOUND = "No collectibles found for this account yet. Watch one you own to see it here.";

describe("Home NFTs tab panel", () => {
  test("with NFTs: cards that open the detail screen, plus Watch and Hidden", () => {
    const html = homeNftsPanel(status, account, preferences, [owned], "complete");
    expect(html).toContain('data-nft-open="SN_MAIN:0x511a2b3:5"');
    expect(html).toContain("Punk #5");
    expect(html).toContain('data-view="nft-watch"');
    expect(html).toContain("Watch by contract");
    expect(html).toContain('data-view="nft-hidden"');
    expect(html).toContain("Hidden collectibles");
    expect(html).not.toContain(NONE_FOUND);
  });

  test("empty, incomplete and unavailable states", () => {
    expect(homeNftsPanel(status, account, preferences, [], "complete")).toContain(NONE_FOUND);
    const incomplete = homeNftsPanel(status, account, preferences, [], "incomplete");
    expect(incomplete).toContain("This list may be missing some NFTs.");
    expect(incomplete).not.toContain(NONE_FOUND);
    const unavailable = homeNftsPanel(status, account, preferences, [], "unavailable");
    expect(unavailable).toContain("Couldn&#39;t load the NFT list. Only NFTs you watch are shown.");
    expect(unavailable).not.toContain(NONE_FOUND);
    const partial = homeNftsPanel(status, account, preferences, [owned], "incomplete");
    expect(partial).toContain("This list may be missing some NFTs.");
    expect(partial).toContain('data-nft-open="SN_MAIN:0x511a2b3:5"');
  });

  test("card actions are real buttons, not bare text", () => {
    const watched = {
      ...preferences,
      nfts: [
        {
          contract: owned.contract,
          id: owned.id,
          networkId: owned.networkId,
          owner: account.address,
          tokenId: owned.tokenId,
        },
      ],
    };
    const html = homeNftsPanel(status, account, watched, [owned], "complete");
    const actions = [
      ...html.matchAll(/<button class="([^"]+)"[^>]*data-(?:nft-spam|remove-nft)=/g),
    ];
    expect(actions).toHaveLength(2);
    for (const [, classes] of actions) {
      expect(classes).toContain("secondary");
      expect(classes).not.toContain("ghost");
    }
    expect(COMPONENT_STYLES).not.toContain(
      ".nft-actions button.danger { background: transparent; }",
    );
  });
});

describe("Home tabs", () => {
  const mount = (selected: HomeTab) => {
    const app = document.createElement("div");
    const { bar, panels } = homeTabPanels(selected, [
      { body: "<p>tokens</p>", label: "Tokens", tab: "tokens" },
      { body: "<p>nfts</p>", label: "NFTs", tab: "nfts" },
    ]);
    app.innerHTML = `${bar}${panels}`;
    document.body.append(app);
    const selections: HomeTab[] = [];
    bindHomeTabs(app, async (tab) => {
      selections.push(tab);
    });
    return { app, selections };
  };

  test("tabs read Tokens · NFTs in order, and a click opens a tab", async () => {
    const { app, selections } = mount("tokens");
    const tabs = [...app.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Tokens", "NFTs"]);
    tabs[1]?.click();
    await Promise.resolve();
    expect(selections).toEqual(["nfts"]);
  });

  test("arrow, Home and End keys move through the tabs", async () => {
    const { app, selections } = mount("tokens");
    const tokens = app.querySelector<HTMLButtonElement>("#home-tab-tokens");
    const nfts = app.querySelector<HTMLButtonElement>("#home-tab-nfts");
    tokens?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    nfts?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    nfts?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
    tokens?.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
    tokens?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await Promise.resolve();
    expect(selections).toEqual(["nfts", "tokens", "tokens", "nfts"]);
  });

  test("activating a tab keeps focus on it across the repaint", async () => {
    const app = document.createElement("div");
    document.body.append(app);
    const paint = (selected: HomeTab): void => {
      const { bar, panels } = homeTabPanels(selected, [
        { body: "", label: "Tokens", tab: "tokens" },
        { body: "", label: "NFTs", tab: "nfts" },
      ]);
      // A repaint replaces the tab buttons, as the shell's does.
      app.innerHTML = `${bar}${panels}`;
      bindHomeTabs(app, async (tab) => paint(tab));
    };
    paint("tokens");
    app.querySelector<HTMLButtonElement>("#home-tab-nfts")?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.activeElement?.id).toBe("home-tab-nfts");
    expect(app.querySelector("#home-tab-nfts")?.getAttribute("aria-selected")).toBe("true");
  });

  test("a tab that is not offered falls back to the first", () => {
    const { bar } = homeTabPanels("nfts", [{ body: "", label: "Tokens", tab: "tokens" }]);
    expect(bar).toContain('aria-selected="true"');
  });
});

describe("NFT send summary at side-panel width", () => {
  test("the art and receipt stack below 420 px instead of squeezing labels", () => {
    expect(JOURNEY_STYLES).toMatch(
      /@media \(max-width: 420px\) \{\s*\.nft-send-identity \{ grid-template-columns: minmax\(0, 1fr\); \}/,
    );
  });
});
