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
import { homeTabs } from "../../../../src/sidepanel/journeys/portfolio/home-tabs";
import {
  STAKING_LOADING,
  type StakingState,
} from "../../../../src/sidepanel/journeys/staking/staking-directory-client";
import {
  type HomeTab,
  homeTabPanels,
} from "../../../../src/sidepanel/journeys/staking/staking-home";
import { bindHomeStaking } from "../../../../src/sidepanel/journeys/staking/staking-home-ui";
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

const NONE_FOUND = "No NFTs found for this account yet. Watch one you own to see it here.";

describe("Home NFTs tab panel", () => {
  test("with NFTs: cards that open the detail screen, plus Watch and Hidden", () => {
    const html = homeNftsPanel(status, account, preferences, [owned], "complete");
    expect(html).toContain('data-nft-open="SN_MAIN:0x511a2b3:5"');
    expect(html).toContain("Punk #5");
    expect(html).toContain('data-view="nft-watch"');
    expect(html).toContain("Watch by contract");
    expect(html).toContain('data-view="nft-hidden"');
    expect(html).toContain("Hidden NFTs");
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

describe("Home tabs (#845's tab mechanism, with Staking between Tokens and NFTs)", () => {
  // Mounts the tabs and #845's bindings; each selection repaints, as the
  // shell's render does, and is recorded from the remembered-tab state.
  const mount = (selected: HomeTab, staking: StakingState | null, nfts: string | null) => {
    const app = document.createElement("div");
    document.body.append(app);
    let state: StakingState = { ...STAKING_LOADING, homeTab: selected };
    const selections: Array<HomeTab | undefined> = [];
    const paint = (): void => {
      const { bar, panels } = homeTabPanels(
        state.homeTab ?? "tokens",
        "<p>tokens</p>",
        staking,
        nfts,
      );
      app.innerHTML = `${bar}${panels}`;
      bindHomeStaking({
        app,
        navigate: () => undefined,
        render: async () => paint(),
        setState: (next) => {
          state = next;
          selections.push(next.homeTab);
        },
        state: () => state,
        status: () => ({}) as WalletStatus,
      });
    };
    paint();
    return { app, selections };
  };
  const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  test("tabs read exactly Tokens · Staking · NFTs, and NFTs is left out when off", () => {
    const all = mount("tokens", STAKING_LOADING, "<p>nfts</p>");
    expect([...all.app.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
      "Tokens",
      "Staking",
      "NFTs",
    ]);
    document.body.replaceChildren();
    const off = mount("tokens", STAKING_LOADING, null);
    expect([...off.app.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
      "Tokens",
      "Staking",
    ]);
    document.body.replaceChildren();
    const noStaking = mount("tokens", null, "<p>nfts</p>");
    expect(
      [...noStaking.app.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent),
    ).toEqual(["Tokens", "NFTs"]);
  });

  test("the menu offers Manage tokens on the Tokens tab only, and Refresh on every tab", () => {
    const menu = (selected: HomeTab, staking: StakingState | null, nfts: string | null) => {
      const app = document.createElement("div");
      app.innerHTML = homeTabs(
        { balances: [] },
        preferences,
        {},
        {},
        "usd",
        undefined,
        null,
        true,
        staking,
        nfts,
        selected,
      );
      return [...app.querySelectorAll('#portfolio-menu [role="menuitem"]')].map((item) =>
        item.textContent?.trim(),
      );
    };
    expect(menu("tokens", STAKING_LOADING, "<p>nfts</p>")).toEqual([
      "Manage tokens",
      "Refresh portfolio",
    ]);
    expect(menu("staking", STAKING_LOADING, "<p>nfts</p>")).toEqual(["Refresh portfolio"]);
    expect(menu("nfts", STAKING_LOADING, "<p>nfts</p>")).toEqual(["Refresh portfolio"]);
    // A tab that is not offered falls back to Tokens, and so does the menu.
    expect(menu("staking", null, "<p>nfts</p>")).toEqual(["Manage tokens", "Refresh portfolio"]);
    // With no tabs at all the section is the token list, so Manage tokens stays.
    expect(menu("tokens", null, null)).toEqual(["Manage tokens", "Refresh portfolio"]);
  });

  test("a click opens NFTs, keeps focus on it, and the choice is remembered", async () => {
    const { app, selections } = mount("tokens", STAKING_LOADING, "<p>nfts</p>");
    app.querySelector<HTMLButtonElement>("#home-tab-nfts")?.click();
    await settle();
    expect(selections).toEqual(["nfts"]);
    expect(document.activeElement?.id).toBe("home-tab-nfts");
    expect(app.querySelector("#home-panel-nfts")?.hasAttribute("hidden")).toBe(false);
  });

  test("arrow, Home and End keys move through the offered tabs only", async () => {
    const { app, selections } = mount("tokens", STAKING_LOADING, "<p>nfts</p>");
    const key = async (key: string): Promise<void> => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key }));
      await settle();
    };
    app.querySelector<HTMLButtonElement>("#home-tab-tokens")?.focus();
    await key("ArrowRight");
    await key("ArrowRight");
    await key("ArrowRight");
    await key("End");
    await key("Home");
    expect(selections).toEqual(["staking", "nfts", "tokens", "nfts", "tokens"]);
    document.body.replaceChildren();
    // With NFTs off the keys skip straight from Tokens to Staking.
    const off = mount("tokens", STAKING_LOADING, null);
    off.app.querySelector<HTMLButtonElement>("#home-tab-tokens")?.focus();
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await settle();
    expect(off.selections).toEqual(["staking"]);
  });

  test("keys on a tab with no offered tabs around it do nothing", async () => {
    const app = document.createElement("div");
    app.innerHTML = '<button data-home-tab="unknown" type="button" role="tab">?</button>';
    document.body.append(app);
    const selections: Array<HomeTab | undefined> = [];
    bindHomeStaking({
      app,
      navigate: () => undefined,
      render: async () => undefined,
      setState: (next) => selections.push(next.homeTab),
      state: () => STAKING_LOADING,
      status: () => ({}) as WalletStatus,
    });
    const tab = app.querySelector("button");
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
      const event = new KeyboardEvent("keydown", { cancelable: true, key });
      tab?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    await settle();
    expect(selections).toEqual([]);
  });

  test("a remembered tab that is not offered falls back to Tokens", () => {
    const { bar } = homeTabPanels("nfts", "", STAKING_LOADING, null);
    expect(bar).toContain(
      'id="home-tab-tokens" data-home-tab="tokens" type="button" role="tab" aria-controls="home-panel-tokens" aria-selected="true"',
    );
  });
});

describe("NFT send summary at side-panel width", () => {
  test("the art and receipt stack below 420 px instead of squeezing labels", () => {
    expect(JOURNEY_STYLES).toMatch(
      /@media \(max-width: 420px\) \{\s*\.nft-send-identity \{ grid-template-columns: minmax\(0, 1fr\); \}/,
    );
  });
});
