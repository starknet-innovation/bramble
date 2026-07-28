/**
 * NFT gallery/detail template checks for auto-discovery: an unsolicited
 * discovered NFT renders its caption but withholds its remote image until the
 * user opens it (deanonymization guard), a manually watched NFT reveals its
 * image, the empty state points at the indexer setting, a discovered token
 * hidden as spam drops out of the grid, and the detail screen opens (and reveals
 * the image) for a discovered token that was never manually watched.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import { nftSendFlow } from "../../src/sidepanel/nft-send-view";
import { nftDetailFlow, nftGalleryFlow, nftHiddenFlow } from "../../src/sidepanel/nft-views";
import type { DiscoveredNft } from "../../src/starknet/nft-metadata";
import type { WalletPreferences } from "../../src/storage/preferences-store";
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

const discovered: DiscoveredNft = {
  attributes: [
    { traitType: "Catalog", value: "CryptoPunks" },
    { displayType: "number", traitType: "Punk ID", value: "5" },
  ],
  collection: "Everai",
  contract: "0x511a2b3",
  description: "A test collectible",
  externalUrl: "https://example.com/everai/5",
  id: "SN_MAIN:0x511a2b3:5",
  image: "https://cdn.example/everai/5.png",
  name: "Everai #5",
  networkId: "SN_MAIN",
  tokenId: "5",
};

describe("NFT gallery auto-discovery", () => {
  test("renders a discovered NFT's caption and controls but not its remote image", () => {
    const html = nftGalleryFlow(status, account, preferences, [discovered]);
    expect(html).toContain('data-nft-open="SN_MAIN:0x511a2b3:5"');
    expect(html).toContain("Everai #5");
    expect(html).toContain("Everai");
    // A discovered-only NFT hides through the persist-as-spam path, not the
    // watched spam toggle, and offers no Remove (nothing is stored yet).
    expect(html).toContain('data-nft-hide="SN_MAIN:0x511a2b3:5"');
    expect(html).not.toContain('data-remove-nft="SN_MAIN:0x511a2b3:5"');
    expect(html).toContain("1 shown");
  });

  test("does not auto-load an unsolicited NFT's remote image on gallery paint", () => {
    // Deanonymization guard: an airdropped/auto-discovered NFT the user never
    // watched must not emit an <img> whose src is an attacker-controllable host,
    // or opening the gallery would leak wallet-address -> IP. The image loads
    // only once the user explicitly opens that NFT (see the detail test below).
    const html = nftGalleryFlow(status, account, preferences, [discovered]);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("https://cdn.example/everai/5.png");
  });

  test("reveals the image for a manually watched (solicited) NFT", () => {
    const watched: WalletPreferences = {
      ...preferences,
      nfts: [
        {
          contract: "0x511a2b3",
          id: "SN_MAIN:0x511a2b3:5",
          label: "My Everai",
          networkId: "SN_MAIN",
          tokenId: "5",
        },
      ],
    };
    const html = nftGalleryFlow(status, account, watched, [discovered]);
    // The discovered row wins the merge (keeps the image) and, being watched, is
    // solicited, so its image is loaded immediately.
    expect(html).toContain(
      '<img class="nft-image nft-image--pixelated" src="https://cdn.example/everai/5.png"',
    );
    expect(html).toContain('loading="eager"');
  });

  test("shows the indexer-aware empty state when nothing is discovered or watched", () => {
    const html = nftGalleryFlow(status, account, preferences, []);
    expect(html).toContain("NFT indexer");
    expect(html).toContain('data-view="nft-watch"');
    expect(html).toContain("0 shown");
  });

  test("drops a discovered NFT that was hidden as spam and lists it under Hidden", () => {
    const withSpam: WalletPreferences = {
      ...preferences,
      nfts: [
        {
          contract: "0x511a2b3",
          id: "SN_MAIN:0x511a2b3:5",
          networkId: "SN_MAIN",
          spam: true,
          tokenId: "5",
        },
      ],
    };
    const html = nftGalleryFlow(status, account, withSpam, [discovered]);
    expect(html).not.toContain('data-nft-open="SN_MAIN:0x511a2b3:5"');
    expect(html).toContain('data-view="nft-hidden"');
    const hidden = nftHiddenFlow(status, withSpam);
    expect(hidden).toContain('data-nft-spam-value="false"');
    expect(html).toContain("0 shown");
  });

  test("detail opens for a discovered token that is not manually watched", () => {
    const html = nftDetailFlow(status, account, preferences, "SN_MAIN:0x511a2b3:5", [discovered]);
    expect(html).toContain('data-view="nft-send"');
    expect(html).toContain("Everai #5");
    expect(html).toContain("0x511a…a2b3");
    expect(html).toContain('<img class="nft-image nft-image--pixelated"');
    expect(html).toContain('loading="eager"');
    expect(html).toContain("A test collectible");
    expect(html).toContain("<h2>Attributes</h2>");
    expect(html).toContain("CryptoPunks");
    const send = nftSendFlow(status, account, preferences, "SN_MAIN:0x511a2b3:5", [discovered]);
    expect(send).toContain('id="nft-review-panel"');
    expect(send).toContain("Review transfer");
  });

  test("keeps rich metadata when the selected NFT is also watched", () => {
    const watched: WalletPreferences = {
      ...preferences,
      nfts: [
        {
          contract: discovered.contract,
          id: discovered.id,
          label: "My Everai",
          networkId: discovered.networkId,
          tokenId: discovered.tokenId,
        },
      ],
    };
    const html = nftDetailFlow(status, account, watched, discovered.id, [discovered]);

    expect(html).toContain('<img class="nft-image nft-image--pixelated"');
    expect(html).toContain("A test collectible");
    expect(html).toContain("CryptoPunks");
  });

  test("detail falls back to an empty state for an unknown selection", () => {
    const html = nftDetailFlow(status, account, preferences, "SN_MAIN:0xdead:1", [discovered]);
    expect(html).toContain("no longer watched");
  });
});
