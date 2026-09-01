/**
 * Boundary checks for NFT discovery: the page-side response guard and the
 * preferences store method that persists (and clears/validates) the indexer
 * endpoint URL.
 */
import { describe, expect, test } from "bun:test";
import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { isDiscoverNftsResponse } from "../../../../src/popup/responses/responses";

const nft: DiscoveredNft = {
  attributes: [{ displayType: "number", traitType: "Punk ID", value: "5" }],
  collection: "Punks",
  contract: "0x511a2b3",
  description: "A test collectible",
  externalUrl: "https://example.com/punks/5",
  id: "SN_MAIN:0x511a2b3:5",
  image: "https://cdn.example/5.png",
  name: "Punk #5",
  networkId: "SN_MAIN",
  tokenId: "5",
};

describe("isDiscoverNftsResponse", () => {
  test("accepts a well-formed response", () => {
    expect(isDiscoverNftsResponse({ nfts: [nft], ok: true })).toBe(true);
    expect(isDiscoverNftsResponse({ nfts: [], ok: true })).toBe(true);
  });

  test("rejects duplicates, bad entries, and non-ok shapes", () => {
    expect(isDiscoverNftsResponse({ nfts: [nft, nft], ok: true })).toBe(false);
    expect(isDiscoverNftsResponse({ nfts: [{ ...nft, image: "http://x" }], ok: true })).toBe(false);
    expect(
      isDiscoverNftsResponse({
        nfts: [{ ...nft, image: "https://127.0.0.1/private.png" }],
        ok: true,
      }),
    ).toBe(false);
    expect(
      isDiscoverNftsResponse({
        nfts: [{ ...nft, attributes: [{ traitType: "", value: "5" }] }],
        ok: true,
      }),
    ).toBe(false);
    expect(isDiscoverNftsResponse({ nfts: [nft], ok: false })).toBe(false);
    expect(isDiscoverNftsResponse({ ok: true })).toBe(false);
  });
});

describe("preferencesStore.setNftIndexerUrl", () => {
  test("stores a valid https endpoint and clears it on empty input", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    const saved = await store.setNftIndexerUrl({ url: "https://indexer.example/api" });
    expect(saved.nftIndexerUrl).toBe("https://indexer.example/api");
    const cleared = await store.setNftIndexerUrl({ url: "  " });
    expect(cleared.nftIndexerUrl).toBeUndefined();
  });

  test("rejects an unusable endpoint", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    await expect(store.setNftIndexerUrl({ url: "ftp://nope" })).rejects.toThrow(
      "Invalid indexer endpoint",
    );
  });
});
