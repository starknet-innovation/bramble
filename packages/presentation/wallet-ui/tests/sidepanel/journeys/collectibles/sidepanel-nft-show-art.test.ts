/**
 * "Show art" on NFT gallery cards: offered only on a discovered-only card and
 * placed before Hide; absent once the NFT is watched. A click watches the NFT
 * through the same `addNft` path as Hide and the watch form (never the spam
 * flag), keeps the button busy while it saves, restores it with an error toast
 * on failure, and re-renders the gallery, which then shows the NFT as watched
 * with its art and Hide plus Remove.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { bindNfts, type NftUiDeps } from "../../../../src/sidepanel/journeys/collectibles/nft-ui";
import { nftGalleryFlow } from "../../../../src/sidepanel/journeys/collectibles/nft-views";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

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

// As Starkscan lists it: no name and no image until the NFT is watched.
const airdrop: DiscoveredNft = {
  collection: "",
  contract: "0x7330000",
  id: "SN_MAIN:0x7330000:11",
  image: "",
  name: "",
  networkId: "SN_MAIN",
  tokenId: "11",
};

const watched: DiscoveredNft = {
  collection: "Everai",
  contract: "0x511a2b3",
  id: "SN_MAIN:0x511a2b3:5",
  image: "data:image/png;base64,iVBORw0KGgo=",
  name: "Everai 5",
  networkId: "SN_MAIN",
  tokenId: "5",
};

const watchOf = (nft: DiscoveredNft) => ({
  contract: nft.contract,
  id: nft.id,
  networkId: nft.networkId,
  tokenId: nft.tokenId,
});

const withWatched: WalletPreferences = { ...preferences, nfts: [watchOf(watched)] };

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => {
  document.body.replaceChildren();
});

const mount = (prefs: WalletPreferences, nfts: readonly DiscoveredNft[]): HTMLElement => {
  const app = document.createElement("div");
  app.replaceChildren(
    document.createRange().createContextualFragment(nftGalleryFlow(status, account, prefs, nfts)),
  );
  document.body.append(app);
  return app;
};

const actionsOf = (app: HTMLElement, id: string): readonly string[] =>
  [
    ...(app
      .querySelector(`[data-nft-open="${id}"]`)
      ?.closest(".nft-card")
      ?.querySelectorAll(".nft-actions > button") ?? []),
  ].map((button) => button.textContent ?? "");

describe("Show art", () => {
  test("is the first action on a discovered-only card and absent on a watched one", () => {
    const app = mount(withWatched, [airdrop, watched]);
    expect(actionsOf(app, airdrop.id)).toEqual(["Show art", "Hide"]);
    expect(actionsOf(app, watched.id)).toEqual(["Hide", "Remove"]);
    const show = app.querySelector<HTMLButtonElement>(`[data-nft-show="${airdrop.id}"]`);
    expect(show?.classList.contains("secondary")).toBe(true);
    expect(show?.classList.contains("small")).toBe(true);
    expect(show?.dataset["nftShowContract"]).toBe(airdrop.contract);
    expect(show?.dataset["nftShowToken"]).toBe("11");
    expect(show?.dataset["nftShowNetwork"]).toBe("SN_MAIN");
    // Nothing remote is painted for the unchosen NFT.
    expect(app.querySelectorAll("img.nft-image")).toHaveLength(1);
  });

  test("watches the NFT, stays busy while saving, and re-renders it as watched", async () => {
    const app = mount(withWatched, [airdrop, watched]);
    const added: unknown[][] = [];
    const spammed: unknown[][] = [];
    let release: () => void = () => undefined;
    let current = withWatched;
    const deps: NftUiDeps = {
      app,
      navigate: () => undefined,
      openDetail: () => undefined,
      render: async () => {
        app.replaceChildren(
          document
            .createRange()
            .createContextualFragment(
              nftGalleryFlow(status, account, current, [
                { ...airdrop, image: "data:image/png;base64,AAAA", name: "Airdrop 11" },
                watched,
              ]),
            ),
        );
      },
      wallet: {
        async addNft(...args: unknown[]) {
          added.push(args);
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          current = { ...withWatched, nfts: [watchOf(watched), watchOf(airdrop)] };
        },
        async loadStatus() {
          return status;
        },
        async setNftSpam(...args: unknown[]) {
          spammed.push(args);
        },
      } as unknown as NftUiDeps["wallet"],
    };
    bindNfts(deps);

    const show = app.querySelector<HTMLButtonElement>(`[data-nft-show="${airdrop.id}"]`);
    show?.click();
    await flush();
    expect(show?.disabled).toBe(true);
    expect(show?.hasAttribute("data-busy")).toBe(true);
    expect(added).toEqual([[airdrop.contract, "11", "SN_MAIN", "NFT #11"]]);

    release();
    await flush();
    await flush();
    expect(spammed).toEqual([]);
    expect(app.querySelector("[data-nft-show]")).toBeNull();
    expect(actionsOf(app, airdrop.id)).toEqual(["Hide", "Remove"]);
    const art = app
      .querySelector(`[data-nft-open="${airdrop.id}"]`)
      ?.querySelector<HTMLImageElement>("img.nft-image");
    expect(art?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });

  test("restores the button and shows an error toast when watching fails", async () => {
    const app = mount(preferences, [airdrop]);
    let renders = 0;
    bindNfts({
      app,
      navigate: () => undefined,
      openDetail: () => undefined,
      render: async () => {
        renders += 1;
      },
      wallet: {
        async addNft() {
          throw new Error("this account does not own that NFT");
        },
        async loadStatus() {
          return status;
        },
      } as unknown as NftUiDeps["wallet"],
    });

    const show = app.querySelector<HTMLButtonElement>(`[data-nft-show="${airdrop.id}"]`);
    show?.click();
    await flush();
    await flush();
    expect(show?.disabled).toBe(false);
    expect(show?.hasAttribute("data-busy")).toBe(false);
    expect(renders).toBe(0);
    expect(document.querySelector(".toast.error .toast-text")?.textContent ?? "").not.toBe("");
  });

  test("ignores a card whose target is incomplete", async () => {
    const app = mount(preferences, [airdrop]);
    const show = app.querySelector<HTMLButtonElement>(`[data-nft-show="${airdrop.id}"]`);
    show?.removeAttribute("data-nft-show-contract");
    let calls = 0;
    bindNfts({
      app,
      navigate: () => undefined,
      openDetail: () => undefined,
      render: async () => undefined,
      wallet: {
        async addNft() {
          calls += 1;
        },
      } as unknown as NftUiDeps["wallet"],
    });
    show?.click();
    await flush();
    expect(calls).toBe(0);
    expect(show?.disabled).toBe(false);
  });
});
