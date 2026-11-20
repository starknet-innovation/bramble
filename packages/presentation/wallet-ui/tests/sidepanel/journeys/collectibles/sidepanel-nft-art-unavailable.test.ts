/**
 * Issue 901: a watched NFT whose art cannot be shown says so on its card
 * instead of a silent placeholder. The note shows at once when the background
 * found no art, waits behind a present image (CSS reveals it if the image
 * fails), and never appears on an unwatched card, whose art is withheld.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
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

const nft = (tokenId: string, extra: Partial<DiscoveredNft> = {}): DiscoveredNft => ({
  collection: "",
  contract: "0x7606cac9",
  id: `SN_MAIN:0x7606cac9:${tokenId}`,
  image: "",
  name: "",
  networkId: "SN_MAIN",
  tokenId,
  ...extra,
});

const failed = nft("1", { artUnavailable: true });
const withArt = nft("2", { image: "data:image/png;base64,iVBORw0KGgo=" });
const pending = nft("3");
const unwatched = nft("4", { artUnavailable: true });

const watchOf = (item: DiscoveredNft) => ({
  contract: item.contract,
  id: item.id,
  networkId: item.networkId,
  tokenId: item.tokenId,
});

const prefs: WalletPreferences = {
  ...preferences,
  nfts: [failed, withArt, pending].map(watchOf),
};

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => {
  document.body.replaceChildren();
});

const noteOf = (app: HTMLElement, id: string): HTMLElement | null =>
  app.querySelector<HTMLElement>(`[data-nft-open="${id}"] .nft-art-note`);

describe("NFT art unavailable note", () => {
  test("shows on a watched card only when its art is missing or fails", () => {
    const app = document.createElement("div");
    app.replaceChildren(
      document
        .createRange()
        .createContextualFragment(
          nftGalleryFlow(status, account, prefs, [failed, withArt, pending, unwatched]),
        ),
    );
    document.body.append(app);

    expect(noteOf(app, failed.id)?.textContent).toBe("Art unavailable");
    expect(noteOf(app, failed.id)?.dataset["shown"]).toBe("true");
    // Behind a present image: rendered, but left to CSS to reveal on failure.
    expect(noteOf(app, withArt.id)?.textContent).toBe("Art unavailable");
    expect(noteOf(app, withArt.id)?.dataset["shown"]).toBeUndefined();
    expect(noteOf(app, pending.id)).toBeNull();
    expect(noteOf(app, unwatched.id)).toBeNull();
  });
});
