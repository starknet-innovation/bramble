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
  normalizeAnimationUri,
  normalizeImageUrl,
  normalizeIndexerNft,
} from "@bramble/portfolio/nft-metadata";

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

  test("passes safe image data URIs through verbatim (idempotent)", () => {
    // A Game-of-Life-style on-chain SVG: base64 image data URI.
    const svg = `data:image/svg+xml;base64,${btoa("<svg xmlns='http://www.w3.org/2000/svg'/>")}`;
    expect(normalizeImageUrl(svg)).toBe(svg);
    expect(normalizeImageUrl(normalizeImageUrl(svg))).toBe(svg);
    // Base64 raster and raw/percent-encoded SVG are also accepted.
    const png = `data:image/png;base64,${btoa("PNGDATA")}`;
    expect(normalizeImageUrl(png)).toBe(png);
    const rawSvg = "data:image/svg+xml,<svg viewBox='0,0,1,1'></svg>";
    expect(normalizeImageUrl(rawSvg)).toBe(rawSvg);
  });

  test("drops unsafe or malformed data URIs", () => {
    expect(normalizeImageUrl("data:text/html,<h1>hi</h1>")).toBe("");
    expect(normalizeImageUrl(`data:application/json;base64,${btoa("{}")}`)).toBe("");
    // Base64 with stray whitespace is not the base64 alphabet.
    expect(normalizeImageUrl("data:image/png;base64,AB CD")).toBe("");
    // Raster types must be base64, never raw.
    expect(normalizeImageUrl("data:image/png,rawbytes")).toBe("");
    expect(normalizeImageUrl("data:image/svg+xml;base64,")).toBe("");
    expect(normalizeImageUrl("data:image/svg+xml")).toBe("");
    expect(normalizeImageUrl(`data:image/svg+xml;base64,${"A".repeat(33_000)}`)).toBe("");
  });
});

describe("normalizeAnimationUri", () => {
  const htmlUri = `data:text/html;base64,${btoa("<html><body><canvas></canvas></body></html>")}`;

  test("passes safe data:text/html URIs through verbatim (idempotent)", () => {
    expect(normalizeAnimationUri(htmlUri)).toBe(htmlUri);
    expect(normalizeAnimationUri(normalizeAnimationUri(htmlUri))).toBe(htmlUri);
    const rawHtml = "data:text/html,<html><body>hi</body></html>";
    expect(normalizeAnimationUri(rawHtml)).toBe(rawHtml);
    const charsetHtml = `data:text/html;charset=utf-8;base64,${btoa("<html></html>")}`;
    expect(normalizeAnimationUri(charsetHtml)).toBe(charsetHtml);
  });

  test("rejects non-html, non-data, malformed, and oversized URIs", () => {
    expect(normalizeAnimationUri(`data:image/svg+xml;base64,${btoa("<svg/>")}`)).toBe("");
    expect(normalizeAnimationUri("https://example.com/a.html")).toBe("");
    expect(normalizeAnimationUri("data:text/html;base64,")).toBe("");
    expect(normalizeAnimationUri("data:text/html;base64,not valid!!")).toBe("");
    expect(normalizeAnimationUri("data:text/html")).toBe("");
    expect(normalizeAnimationUri(`data:text/html;base64,${"A".repeat(33_000)}`)).toBe("");
    expect(normalizeAnimationUri(undefined)).toBe("");
    expect(normalizeAnimationUri(42)).toBe("");
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

  test("accepts an on-chain SVG data-URI image", () => {
    const image = `data:image/svg+xml;base64,${btoa("<svg xmlns='http://www.w3.org/2000/svg'/>")}`;
    expect(isDiscoveredNft({ ...valid, image })).toBe(true);
  });

  test("accepts a self-contained data:text/html animationUrl, rejects a remote one", () => {
    const animationUrl = `data:text/html;base64,${btoa("<html><body></body></html>")}`;
    expect(isDiscoveredNft({ ...valid, animationUrl })).toBe(true);
    expect(isDiscoveredNft({ ...valid, animationUrl: "https://example.com/a.html" })).toBe(false);
  });

  test("rejects a mismatched id, bad network, or non-https image", () => {
    expect(isDiscoveredNft({ ...valid, id: "SN_MAIN:0x511a2b3:6" })).toBe(false);
    expect(isDiscoveredNft({ ...valid, networkId: "SN_FAKE" })).toBe(false);
    expect(isDiscoveredNft({ ...valid, image: "http://x" })).toBe(false);
    expect(isDiscoveredNft({ ...valid, extra: 1 })).toBe(false);
  });
});
