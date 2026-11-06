/**
 * The opt-in collectibles preview: with it off (the default) nothing renders a
 * way into the parked gallery and no NFT lane runs; with it on, the portfolio
 * menu links the gallery, the indexer field appears, and only gallery screens
 * load collectible data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { emptyRenderCache } from "../../../../src/sidepanel/app/rendering/render-cache";
import { hydrateNfts, nftSnapshot } from "../../../../src/sidepanel/app/sync/hydrate-nfts";
import { homeTabs } from "../../../../src/sidepanel/journeys/portfolio/home-tabs";
import { collectiblesSettings } from "../../../../src/sidepanel/journeys/settings/collectibles-settings-view";
import { bindEndpointSettings } from "../../../../src/sidepanel/journeys/settings/endpoint-ui";
import { advancedNetworkFlow } from "../../../../src/sidepanel/journeys/settings/network-views";
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

const prefs = (overrides: Partial<WalletPreferences> = {}): WalletPreferences => ({
  ...defaultWalletPreferences(),
  ...overrides,
});

const nft = (id: string, name: string): DiscoveredNft =>
  ({ contract: "0x1", id, name, networkId: "SN_MAIN", tokenId: id }) as unknown as DiscoveredNft;

const disclosure = (id: string, title: string, state: string, body: string): string =>
  `<details data-disclosure="${id}"><summary>${title} ${state}</summary>${body}</details>`;

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("collectibles preview entry point", () => {
  test("the portfolio menu links the gallery only with the preview on", () => {
    const off = homeTabs({ balances: [] }, prefs(), {}, {}, "usd");
    const on = homeTabs({ balances: [] }, prefs({ collectiblesPreview: true }), {}, {}, "usd");
    expect(off).not.toContain('data-view="nfts"');
    expect(on).toContain('data-view="nfts"');
  });

  test("the advanced screen shows the indexer field only with the preview on", () => {
    const off = advancedNetworkFlow(status, prefs({ nftIndexerUrl: "https://idx.example" }));
    expect(off).toContain('data-disclosure="collectibles-preview"');
    expect(off).not.toContain("nft-indexer-form");
    const on = advancedNetworkFlow(status, prefs({ collectiblesPreview: true }));
    expect(on).toContain("nft-indexer-form");
    expect(on).toContain('id="collectibles-preview"');
  });

  test("Starkscan is offered only when its route exists and no indexer is set", () => {
    const preview = prefs({ collectiblesPreview: true });
    expect(collectiblesSettings(preview, disclosure, null)).not.toContain("data-indexer-default");
    const offered = collectiblesSettings(preview, disclosure, "https://nft.bramble.example/v1");
    expect(offered).toContain('data-indexer-default="https://nft.bramble.example/v1"');
    expect(offered).toContain(
      "Finds ERC-721 NFTs on Mainnet. Starkscan and nft.bramble.example see this account's address. Watch ERC-1155 NFTs by contract.",
    );
    expect(offered).toContain("Use Starkscan");
    const configured = collectiblesSettings(
      prefs({ collectiblesPreview: true, nftIndexerUrl: "https://mine.example" }),
      disclosure,
      "https://nft.bramble.example/v1",
    );
    expect(configured).not.toContain("data-indexer-default");
    expect(configured).toContain("NFT indexer Configured");
    const chosen = collectiblesSettings(
      prefs({ collectiblesPreview: true, nftIndexerUrl: "https://nft.bramble.example/v1" }),
      disclosure,
      "https://nft.bramble.example/v1",
    );
    expect(chosen).toContain("NFT indexer Starkscan");
    expect(collectiblesSettings(prefs(), disclosure, "https://x.example")).not.toContain(
      "data-indexer-default",
    );
  });
});

describe("collectibles preview hydration", () => {
  const run = (overrides: {
    readonly activeView: Parameters<typeof hydrateNfts>[0]["activeView"];
    readonly ambient?: boolean;
    readonly preview: boolean;
  }) => {
    const cache = emptyRenderCache();
    cache.preferences = prefs({ collectiblesPreview: overrides.preview });
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

  test("nothing loads while the preview is off", async () => {
    const { calls, done } = run({ activeView: "nfts", preview: false });
    await done;
    expect(calls).toEqual([]);
  });

  test("home, the watch form and ambient refreshes load nothing", async () => {
    for (const input of [
      { activeView: "home", preview: true },
      { activeView: "nft-watch", preview: true },
      { activeView: "nfts", ambient: true, preview: true },
    ] as const) {
      const { calls, done } = run(input);
      await done;
      expect(calls).toEqual([]);
    }
  });

  test("the gallery loads both lanes and an explicit watch wins its id", async () => {
    const { cache, calls, done } = run({ activeView: "nfts", preview: true });
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

describe("collectibles preview bindings", () => {
  const mount = (html: string, wallet: Partial<SidepanelWallet>, granted = true) => {
    const app = document.createElement("div");
    app.innerHTML = html;
    document.body.append(app);
    const requested: string[][] = [];
    bindEndpointSettings({
      app,
      networkId: () => "SN_MAIN",
      permissions: {
        request: async ({ origins }: { readonly origins: readonly string[] }) => {
          requested.push([...origins]);
          return granted;
        },
      } as never,
      render: async () => undefined,
      wallet: { loadStatus: async () => status, ...wallet } as SidepanelWallet,
    });
    return { app, requested };
  };

  test("the switch writes its literal state, and a failure restores it", async () => {
    const writes: Array<boolean | undefined> = [];
    const html = collectiblesSettings(prefs(), disclosure, null);
    const { app } = mount(html, {
      setDisplay: async (input) => {
        writes.push(input.collectiblesPreview);
        if (writes.length > 1) throw new Error("store offline");
      },
    });
    const toggle = app.querySelector<HTMLInputElement>("#collectibles-preview");
    if (!toggle) throw new Error("missing toggle");
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await tick();
    expect(writes).toEqual([true]);
    toggle.disabled = false;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await tick();
    expect(writes).toEqual([true, false]);
    expect(toggle.checked).toBe(true);
  });

  test("the Bramble indexer is saved only after its host is granted", async () => {
    const saved: string[] = [];
    const html = collectiblesSettings(
      prefs({ collectiblesPreview: true }),
      disclosure,
      "https://nft.bramble.example/v1",
    );
    const setNftIndexerUrl = async (url: string) => {
      saved.push(url);
    };
    const denied = mount(html, { setNftIndexerUrl }, false);
    denied.app.querySelector<HTMLButtonElement>("[data-indexer-default]")?.click();
    await tick();
    expect(denied.requested).toEqual([["https://nft.bramble.example/*"]]);
    expect(saved).toEqual([]);
    document.body.replaceChildren();
    const granted = mount(html, { setNftIndexerUrl });
    granted.app.querySelector<HTMLButtonElement>("[data-indexer-default]")?.click();
    await tick();
    expect(saved).toEqual(["https://nft.bramble.example/v1"]);
  });
});
