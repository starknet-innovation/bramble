/**
 * NFT metadata normalization checks: indexer records fold into canonical
 * discovered NFTs, image URLs are gatewayed/filtered to renderable https, and
 * the guard rejects malformed shapes.
 */
import { describe, expect, test } from "bun:test";
import {
  type DiscoveredNft,
  isDiscoveredNft,
  nftId,
  normalizeImageUrl,
  normalizeIndexerNft,
} from "../../src/starknet/nft-metadata";

const CONTRACT = "0x0511a2b3";
const CANONICAL = "0x511a2b3";

describe("normalizeImageUrl", () => {
  test("keeps https URLs and rewrites ipfs through the gateway", () => {
    expect(normalizeImageUrl("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
    expect(normalizeImageUrl("ipfs://bafyCID/1.png")).toBe("https://ipfs.io/ipfs/bafyCID/1.png");
    expect(normalizeImageUrl("ipfs://ipfs/bafyCID")).toBe("https://ipfs.io/ipfs/bafyCID");
  });

  test("drops non-https/ipfs and non-string references", () => {
    expect(normalizeImageUrl("http://insecure.example/a.png")).toBe("");
    expect(normalizeImageUrl("javascript:alert(1)")).toBe("");
    expect(normalizeImageUrl("ipfs://")).toBe("");
    expect(normalizeImageUrl(42)).toBe("");
    expect(normalizeImageUrl(undefined)).toBe("");
  });
});

describe("normalizeIndexerNft", () => {
  test("canonicalizes contract/token id and derives the shared id", () => {
    const nft = normalizeIndexerNft(
      {
        collection_name: "Punks",
        contract_address: CONTRACT,
        image_url: "ipfs://cid/5.png",
        name: "Punk #5",
        token_id: "5",
      },
      "SN_MAIN",
    );
    expect(nft).toEqual({
      collection: "Punks",
      contract: CANONICAL,
      id: nftId("SN_MAIN", CANONICAL, "5"),
      image: "https://ipfs.io/ipfs/cid/5.png",
      name: "Punk #5",
      networkId: "SN_MAIN",
      tokenId: "5",
    });
    expect(isDiscoveredNft(nft)).toBe(true);
  });

  test("accepts a numeric token id and defaults optional text/image to empty", () => {
    const nft = normalizeIndexerNft({ contract_address: CONTRACT, token_id: 9 }, "SN_SEPOLIA");
    expect(nft).toMatchObject({ collection: "", image: "", name: "", tokenId: "9" });
  });

  test("rejects records with a missing or unusable contract/token id", () => {
    expect(normalizeIndexerNft({ token_id: "1" }, "SN_MAIN")).toBeNull();
    expect(normalizeIndexerNft({ contract_address: "0x0", token_id: "1" }, "SN_MAIN")).toBeNull();
    expect(
      normalizeIndexerNft({ contract_address: CONTRACT, token_id: "-1" }, "SN_MAIN"),
    ).toBeNull();
    expect(
      normalizeIndexerNft({ contract_address: CONTRACT, token_id: "0x5" }, "SN_MAIN"),
    ).toBeNull();
    expect(normalizeIndexerNft("nope", "SN_MAIN")).toBeNull();
  });
});

describe("isDiscoveredNft", () => {
  const valid: DiscoveredNft = {
    collection: "Punks",
    contract: CANONICAL,
    id: nftId("SN_MAIN", CANONICAL, "5"),
    image: "https://cdn.example/5.png",
    name: "Punk #5",
    networkId: "SN_MAIN",
    tokenId: "5",
  };

  test("accepts a well-formed record and an empty image", () => {
    expect(isDiscoveredNft(valid)).toBe(true);
    expect(isDiscoveredNft({ ...valid, image: "" })).toBe(true);
  });

  test("rejects a mismatched id, bad network, or non-https image", () => {
    expect(isDiscoveredNft({ ...valid, id: "SN_MAIN:0x511a2b3:6" })).toBe(false);
    expect(isDiscoveredNft({ ...valid, networkId: "SN_FAKE" })).toBe(false);
    expect(isDiscoveredNft({ ...valid, image: "http://x" })).toBe(false);
    expect(isDiscoveredNft({ ...valid, extra: 1 })).toBe(false);
  });
});
