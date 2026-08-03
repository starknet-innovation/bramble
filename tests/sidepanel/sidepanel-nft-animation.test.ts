/**
 * On-chain animation rendering through the real DOM binding: the detail view and
 * the collectibles-tile both surface a "Play animation" affordance for a token
 * with a data:text/html animation, and clicking it points the sandboxed iframe at
 * the renderer; a token without an animation shows no such control.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import { homeTabs } from "../../src/sidepanel/home-tabs";
import { bindNfts, type NftUiDeps } from "../../src/sidepanel/nft-ui";
import { nftDetailFlow, nftGalleryFlow } from "../../src/sidepanel/nft-views";
import type { DiscoveredNft } from "../../src/starknet/nft-metadata";
import type { WalletPreferences } from "../../src/storage/preferences-store";
import { registerDom, unregisterDom } from "../support/groups-harness";
import { account, preferences } from "../support/sidepanel-fixtures";

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

const plain: DiscoveredNft = {
  collection: "Everai",
  contract: "0x511a2b3",
  id: "SN_MAIN:0x511a2b3:5",
  image: "https://cdn.example/everai/5.png",
  name: "Everai #5",
  networkId: "SN_MAIN",
  tokenId: "5",
};

const animated: DiscoveredNft = {
  ...plain,
  animationUrl: `data:text/html;base64,${btoa("<html><body><canvas></canvas></body></html>")}`,
  contract: "0x1e8e1c",
  id: "SN_MAIN:0x1e8e1c:2924",
  name: "Lifeform 2924",
  tokenId: "2924",
};

const bind = (app: Element): void => {
  document.body.append(app);
  bindNfts({
    app,
    openDetail: () => undefined,
    render: async () => undefined,
    wallet: {
      async loadStatus() {
        return status;
      },
    } as unknown as NftUiDeps["wallet"],
  });
};

const fromHtml = (html: string): Element => {
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(html));
  return app;
};

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => {
  document.body.replaceChildren();
});

describe("NFT detail animation", () => {
  test("reveals the sandbox iframe only after the user presses play", () => {
    const app = fromHtml(nftDetailFlow(status, account, preferences, animated.id, [animated]));
    bind(app);
    const play = app.querySelector<HTMLButtonElement>("[data-nft-play]");
    const frame = app.querySelector<HTMLIFrameElement>("iframe.nft-animation");
    expect(play).not.toBeNull();
    expect(frame?.hidden).toBe(true);
    expect(frame?.getAttribute("src")).toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.referrerPolicy).toBe("no-referrer");

    play?.click();

    expect(frame?.hidden).toBe(false);
    expect(frame?.getAttribute("src")).toBe(
      `sandbox/render.html#${encodeURIComponent(animated.animationUrl ?? "")}`,
    );
    expect(play?.hasAttribute("hidden")).toBe(true);
  });

  test("shows no play control for a collectible without an animation", () => {
    const app = fromHtml(nftDetailFlow(status, account, preferences, plain.id, [plain]));
    bind(app);
    expect(app.querySelector("[data-nft-play]")).toBeNull();
    expect(app.querySelector("iframe.nft-animation")).toBeNull();
  });
});

describe("NFT collectibles-tile animation", () => {
  test("surfaces a play affordance on the tile and plays in place", () => {
    const watchedPrefs: WalletPreferences = {
      ...preferences,
      nfts: [
        {
          contract: animated.contract,
          id: animated.id,
          label: animated.name,
          networkId: animated.networkId,
          tokenId: animated.tokenId,
        },
      ],
    };
    const app = fromHtml(nftGalleryFlow(status, account, watchedPrefs, [animated]));
    bind(app);

    const play = app.querySelector<HTMLButtonElement>(".nft-play-tile");
    const frame = app.querySelector<HTMLIFrameElement>("iframe.nft-animation--tile");
    expect(play).not.toBeNull();
    expect(frame?.hidden).toBe(true);

    play?.click();

    expect(frame?.hidden).toBe(false);
    expect(frame?.getAttribute("src")).toBe(
      `sandbox/render.html#${encodeURIComponent(animated.animationUrl ?? "")}`,
    );
    expect(play?.hasAttribute("hidden")).toBe(true);
  });

  test("shows no tile play affordance for a collectible without an animation", () => {
    const app = fromHtml(nftGalleryFlow(status, account, preferences, [plain]));
    bind(app);
    expect(app.querySelector(".nft-play-tile")).toBeNull();
  });
});

describe("NFT home Collectibles-tab animation", () => {
  const watchedPrefs: WalletPreferences = {
    ...preferences,
    nfts: [
      {
        contract: animated.contract,
        id: animated.id,
        label: animated.name,
        networkId: animated.networkId,
        tokenId: animated.tokenId,
      },
    ],
  };

  test("surfaces and plays the animation from the home Collectibles tile", () => {
    const app = fromHtml(
      homeTabs({ balances: [] }, watchedPrefs, {}, {}, "usd", status, [animated]),
    );
    bind(app);

    const play = app.querySelector<HTMLButtonElement>(".collectible-tile .nft-play-tile");
    const frame = app.querySelector<HTMLIFrameElement>(
      ".collectible-tile iframe.nft-animation--tile",
    );
    expect(play).not.toBeNull();
    expect(frame?.hidden).toBe(true);

    play?.click();

    expect(frame?.hidden).toBe(false);
    expect(frame?.getAttribute("src")).toBe(
      `sandbox/render.html#${encodeURIComponent(animated.animationUrl ?? "")}`,
    );
    expect(play?.hasAttribute("hidden")).toBe(true);
  });

  test("shows no play control on the home tile for a collectible without an animation", () => {
    const plainPrefs: WalletPreferences = {
      ...preferences,
      nfts: [
        {
          contract: plain.contract,
          id: plain.id,
          label: plain.name,
          networkId: plain.networkId,
          tokenId: plain.tokenId,
        },
      ],
    };
    const app = fromHtml(homeTabs({ balances: [] }, plainPrefs, {}, {}, "usd", status, [plain]));
    expect(app.querySelector(".nft-play-tile")).toBeNull();
  });
});
