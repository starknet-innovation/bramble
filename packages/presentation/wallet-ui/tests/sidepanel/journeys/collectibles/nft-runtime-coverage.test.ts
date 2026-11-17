/**
 * The panel keeps the indexer's coverage from a valid reply and treats any
 * refused or malformed reply as an unavailable index, never an empty one.
 */
import { describe, expect, test } from "bun:test";
import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import { createNftRuntimeClient } from "../../../../src/sidepanel/journeys/collectibles/nft-runtime";

const nft: DiscoveredNft = {
  collection: "",
  contract: "0x511a2b3",
  id: "SN_MAIN:0x511a2b3:5",
  image: "",
  name: "",
  networkId: "SN_MAIN",
  tokenId: "5",
};

const discover = (reply: unknown) =>
  createNftRuntimeClient(async () => reply).discoverNfts(false, "scope");

describe("NFT discovery coverage in the panel", () => {
  test("keeps a valid coverage", async () => {
    expect(await discover({ coverage: "incomplete", nfts: [nft], ok: true })).toEqual({
      coverage: "incomplete",
      nfts: [nft],
    });
  });

  test("an unknown coverage or an error reply is unavailable", async () => {
    const unavailable = { coverage: "unavailable", nfts: [] } as const;
    expect(await discover({ coverage: "partial", nfts: [], ok: true })).toEqual(unavailable);
    expect(await discover({ error: "locked" })).toEqual(unavailable);
  });

  test("watched loads still return only the NFTs", async () => {
    const client = createNftRuntimeClient(async () => ({ nfts: [nft], ok: true }));
    expect(await client.loadWatchedNfts("scope")).toEqual([nft]);
  });
});
