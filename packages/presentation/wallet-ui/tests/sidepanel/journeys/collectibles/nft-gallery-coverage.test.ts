/**
 * The gallery never reads a partial or failed index as "no collectibles": an
 * incomplete list says it may be missing NFTs, a failed one says only watched
 * NFTs are shown, and the "none found" line is kept for a complete answer or
 * no indexer at all.
 */
import { describe, expect, test } from "bun:test";
import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { nftGalleryFlow } from "../../../../src/sidepanel/journeys/collectibles/nft-views";

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
  name: "",
  networkId: "SN_MAIN",
  tokenId: "5",
};

const NONE_FOUND = "No NFTs found for this account yet.";
const MISSING = "This list may be missing some NFTs.";
const FAILED = "Couldn't load the NFT list. Only NFTs you watch are shown.";

describe("NFT gallery coverage", () => {
  test("an empty incomplete list says it may be missing NFTs, not that there are none", () => {
    const html = nftGalleryFlow(status, account, preferences, [], "incomplete");
    expect(html).toContain(MISSING);
    expect(html).not.toContain(NONE_FOUND);
  });

  test("an empty failed list says so, not that there are none", () => {
    const html = nftGalleryFlow(status, account, preferences, [], "unavailable");
    expect(html).toContain(FAILED.replace("'", "&#39;"));
    expect(html).not.toContain(NONE_FOUND);
  });

  test("a partial list still shows what it has, under the note", () => {
    const html = nftGalleryFlow(status, account, preferences, [owned], "incomplete");
    expect(html).toContain(MISSING);
    expect(html).toContain('data-nft-open="SN_MAIN:0x511a2b3:5"');
  });

  test("a complete answer or no indexer keeps the usual lines", () => {
    for (const coverage of ["complete", "none"] as const) {
      const empty = nftGalleryFlow(status, account, preferences, [], coverage);
      expect(empty).toContain(NONE_FOUND);
      const listed = nftGalleryFlow(status, account, preferences, [owned], coverage);
      expect(listed).not.toContain(MISSING);
      expect(listed).not.toContain("Couldn");
    }
  });
});
