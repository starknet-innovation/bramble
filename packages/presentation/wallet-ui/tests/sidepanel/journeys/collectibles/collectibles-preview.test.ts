/**
 * NFTs on Home (Derek, 2026-11-06): NFTs are on by default and the user can
 * turn them off ("Show NFTs on Home" in Appearance & currency). While on, Home
 * reads Tokens · NFTs, the NFTs tab shows the gallery content, and only that
 * tab or a gallery screen loads NFT data. Turned off (an explicit `false`),
 * nothing NFT is rendered or loaded. Unknown preferences fail closed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { emptyRenderCache } from "../../../../src/sidepanel/app/rendering/render-cache";
import { hydrateNfts, nftSnapshot } from "../../../../src/sidepanel/app/sync/hydrate-nfts";
import { homeTabs } from "../../../../src/sidepanel/journeys/portfolio/home-tabs";
import { homeScreen } from "../../../../src/sidepanel/journeys/portfolio/home-view";
import { collectiblesSettings } from "../../../../src/sidepanel/journeys/settings/collectibles-settings-view";
import { advancedNetworkFlow } from "../../../../src/sidepanel/journeys/settings/network-views";
import { bindAppearance } from "../../../../src/sidepanel/journeys/settings/settings-ui";
import { appearanceFlow } from "../../../../src/sidepanel/journeys/settings/settings-views";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const status: WalletStatus = {
  accountCount: 1,
  accounts: [],
  activeAccountId: "SN_MAIN:0x1",
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

// Default preferences carry no `collectiblesPreview`: NFTs are on.
const prefs = (overrides: Partial<WalletPreferences> = {}): WalletPreferences => {
  const { collectiblesPreview: _unset, ...defaults } = defaultWalletPreferences();
  return { ...defaults, ...overrides };
};

const nft = (id: string, name: string): DiscoveredNft =>
  ({ contract: "0x1", id, name, networkId: "SN_MAIN", tokenId: id }) as unknown as DiscoveredNft;

const disclosure = (id: string, title: string, state: string, body: string): string =>
  `<details data-disclosure="${id}"><summary>${title} ${state}</summary>${body}</details>`;

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const home = (preferences: WalletPreferences | null): string =>
  homeScreen(
    status,
    null,
    { balances: [] },
    0,
    null,
    preferences,
    {},
    {},
    "usd",
    { error: null, loading: false, value: null },
    null,
    false,
    { coverage: "none", discovered: [], selected: "nfts" },
  );

describe("NFTs on Home", () => {
  test("on by default: Home reads Tokens · NFTs; an explicit false or unknown hides it", () => {
    expect(defaultWalletPreferences().collectiblesPreview).toBeUndefined();
    expect(home(prefs())).toContain('data-home-tab="nfts"');
    expect(home(prefs({ collectiblesPreview: true }))).toContain('data-home-tab="nfts"');
    expect(home(prefs({ collectiblesPreview: false }))).not.toContain('data-home-tab="nfts"');
    expect(home(null)).not.toContain('data-home-tab="nfts"');
  });

  test("the tab replaces the Collectibles item in the Portfolio actions menu", () => {
    const html = homeTabs({ balances: [] }, prefs(), {}, {}, "usd", undefined, null, true, {
      panel: "<p>nfts</p>",
      selected: "tokens",
    });
    expect(html).not.toContain(">Collectibles<");
    expect(html).not.toMatch(/data-view="nfts"[^>]*role="menuitem"/);
    expect(html.match(/role="menuitem"/g)).toHaveLength(2);
  });

  test("the open tab is shown and the other panel is hidden", () => {
    const nftsOpen = homeTabs({ balances: [] }, prefs(), {}, {}, "usd", undefined, null, true, {
      panel: "<p>gallery</p>",
      selected: "nfts",
    });
    expect(nftsOpen).toContain(
      'id="home-tab-nfts" data-home-tab="nfts" type="button" role="tab" aria-controls="home-panel-nfts" aria-selected="true"',
    );
    expect(nftsOpen).toContain(
      'id="home-panel-tokens" role="tabpanel" aria-labelledby="home-tab-tokens" hidden',
    );
    expect(nftsOpen).toContain('aria-labelledby="home-tab-nfts"><p>gallery</p>');
  });
});

describe("Settings for NFTs", () => {
  test("Appearance has the toggle, on by default, with the disclosure line", () => {
    const on = appearanceFlow(status, prefs());
    expect(on).toMatch(/id="nfts-on-home"[^>]*checked|checked[^>]*id="nfts-on-home"/);
    expect(on).toContain("Show NFTs on Home");
    expect(on).toContain(
      "On Mainnet, Starkscan finds this account's ERC-721 NFTs and sees its address. Every NFT shown is checked on-chain.",
    );
    const off = appearanceFlow(status, prefs({ collectiblesPreview: false }));
    expect(off).toContain('id="nfts-on-home"');
    expect(off).not.toMatch(/id="nfts-on-home"[^>]*checked|checked[^>]*id="nfts-on-home"/);
  });

  test("Advanced endpoints shows the indexer field while NFTs are on, and no switch", () => {
    const on = advancedNetworkFlow(status, prefs());
    expect(on).toContain("nft-indexer-form");
    expect(on).not.toContain("collectibles-preview");
    const off = advancedNetworkFlow(status, prefs({ collectiblesPreview: false }));
    expect(off).not.toContain("nft-indexer-form");
  });

  test("the indexer field names Starkscan when empty", () => {
    const empty = collectiblesSettings(prefs(), disclosure);
    expect(empty).toContain("NFT indexer Starkscan");
    expect(empty).toContain(
      "Leave empty to use Starkscan, which finds ERC-721 NFTs on Mainnet only. Watch ERC-1155 NFTs by contract.",
    );
    const configured = collectiblesSettings(
      prefs({ nftIndexerUrl: "https://mine.example" }),
      disclosure,
    );
    expect(configured).toContain("NFT indexer Configured");
  });

  test("the toggle writes its literal state, and a failure restores it", async () => {
    const writes: Array<boolean | undefined> = [];
    const app = document.createElement("div");
    app.innerHTML = appearanceFlow(status, prefs());
    document.body.append(app);
    bindAppearance({
      app,
      expandedGroup: () => null,
      networkId: () => "SN_MAIN",
      refresh: async () => status,
      render: async () => undefined,
      setExpandedGroup: () => undefined,
      startAddAccount: () => undefined,
      wallet: {
        loadStatus: async () => status,
        setDisplay: async (input: { readonly collectiblesPreview?: boolean }) => {
          writes.push(input.collectiblesPreview);
          if (writes.length > 1) throw new Error("store offline");
        },
      } as unknown as SidepanelWallet,
    });
    const toggle = app.querySelector<HTMLInputElement>("#nfts-on-home");
    if (!toggle) throw new Error("missing toggle");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await tick();
    expect(writes).toEqual([false]);
    toggle.disabled = false;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await tick();
    expect(writes).toEqual([false, true]);
    expect(toggle.checked).toBe(false);
  });
});

describe("NFT hydration", () => {
  const run = (overrides: {
    readonly activeView: Parameters<typeof hydrateNfts>[0]["activeView"];
    readonly ambient?: boolean;
    readonly homeTab?: "nfts" | "tokens";
    readonly preferences?: WalletPreferences | null;
  }) => {
    const cache = emptyRenderCache();
    cache.preferences = overrides.preferences === undefined ? prefs() : overrides.preferences;
    cache.homeTab = overrides.homeTab ?? "tokens";
    const calls: string[] = [];
    const jobs: Array<Promise<unknown>> = [];
    const wallet = {
      discoverNfts: async (includeWatched: boolean, scope: string) => {
        calls.push(`discover:${includeWatched}:${scope}`);
        return { coverage: "incomplete", nfts: [nft("1", "indexed"), nft("2", "indexed")] };
      },
      loadWatchedNfts: async (scope: string) => {
        calls.push(`watched:${scope}`);
        return [nft("2", "watched")];
      },
    };
    hydrateNfts(
      {
        activeView: overrides.activeView,
        ambient: overrides.ambient ?? false,
        cache,
        status,
        wallet: wallet as unknown as SidepanelWallet,
      },
      (load, assign) => {
        jobs.push(load().then(assign));
      },
    );
    return { cache, calls, done: Promise.all(jobs) };
  };

  test("Home loads NFTs only while its NFTs tab is open", async () => {
    const tokens = run({ activeView: "home", homeTab: "tokens" });
    await tokens.done;
    expect(tokens.calls).toEqual([]);
    const nftsTab = run({ activeView: "home", homeTab: "nfts" });
    await nftsTab.done;
    expect(nftsTab.calls).toEqual([
      "watched:SN_MAIN:SN_MAIN:0x1",
      "discover:false:SN_MAIN:SN_MAIN:0x1",
    ]);
  });

  test("nothing loads with NFTs turned off, unknown preferences, the watch form or ambient refreshes", async () => {
    for (const input of [
      { activeView: "home", homeTab: "nfts", preferences: prefs({ collectiblesPreview: false }) },
      { activeView: "nfts", preferences: prefs({ collectiblesPreview: false }) },
      { activeView: "nfts", preferences: null },
      { activeView: "nft-watch" },
      { activeView: "nfts", ambient: true },
    ] as const) {
      const { calls, done } = run(input);
      await done;
      expect(calls).toEqual([]);
    }
  });

  test("the gallery loads both lanes by default and an explicit watch wins its id", async () => {
    const { cache, calls, done } = run({ activeView: "nfts" });
    await done;
    expect(calls).toEqual(["watched:SN_MAIN:SN_MAIN:0x1", "discover:false:SN_MAIN:SN_MAIN:0x1"]);
    expect(cache.discoveredNfts.map((item) => `${item.id}:${item.name}`)).toEqual([
      "1:indexed",
      "2:watched",
    ]);
    expect(cache.nftCoverage).toBe("incomplete");
    expect(nftSnapshot([], [])).toEqual([]);
  });
});
