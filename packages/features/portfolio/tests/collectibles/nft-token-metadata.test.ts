/**
 * NFT metadata URI compatibility and safety checks. Existing percent-encoded
 * on-chain metadata and new Base64 data URIs decode locally, while remote
 * metadata remains opt-in, byte-bounded, credentialless, and public-HTTPS only.
 */
import { describe, expect, test } from "bun:test";
import { type NftMetadataHttp, resolveNftMetadataUri } from "@bramble/portfolio/nft-token-metadata";

const metadata = {
  attributes: [
    { trait_type: "Catalog", value: "CryptoPunks" },
    { display_type: "number", trait_type: "Punk ID", value: 0 },
  ],
  description: "A test collectible",
  external_url: "https://example.com/punks/0",
  image: "ipfs://bafybeigdyrzt/image.png",
  name: "Starknet Test Punk #0",
};

const unexpectedHttp: NftMetadataHttp = async () => {
  throw new Error("data URIs must not fetch");
};

describe("resolveNftMetadataUri", () => {
  test("reads the already-minted percent-encoded metadata format", async () => {
    const resolved = await resolveNftMetadataUri(
      `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`,
      unexpectedHttp,
    );

    expect(resolved).toEqual({
      animationUrl: "",
      attributes: [
        { traitType: "Catalog", value: "CryptoPunks" },
        { displayType: "number", traitType: "Punk ID", value: "0" },
      ],
      collection: "",
      description: "A test collectible",
      externalUrl: "https://example.com/punks/0",
      image: "https://ipfs.io/ipfs/bafybeigdyrzt/image.png",
      name: "Starknet Test Punk #0",
    });
  });

  test("reads explorer-friendly Base64 JSON data URIs", async () => {
    const encoded = btoa(JSON.stringify({ collection: { name: "MC Punks" }, ...metadata }));
    const resolved = await resolveNftMetadataUri(
      `data:application/json;base64,${encoded}`,
      unexpectedHttp,
    );

    expect(resolved?.collection).toBe("MC Punks");
    expect(resolved?.name).toBe("Starknet Test Punk #0");
  });

  test("preserves a fully on-chain SVG image (Game of Life token_uri)", async () => {
    // Mirrors gol_metadata.cairo::token_uri — a base64 JSON document whose image
    // is itself an on-chain base64 SVG data URI, with numeric trait values.
    const image = `data:image/svg+xml;base64,${btoa(
      "<svg xmlns='http://www.w3.org/2000/svg' width='150' height='150'/>",
    )}`;
    const golJson = {
      attributes: [
        { trait_type: "Status", value: "Alive" },
        { trait_type: "Kind", value: "Loop" },
        { trait_type: "Sequence Length", value: 3 },
        { trait_type: "Age", value: 7 },
      ],
      description: "An autonomous Conway's Game of Life lifeform living forever on Starknet.",
      image,
      name: "Lifeform #1",
    };
    const resolved = await resolveNftMetadataUri(
      `data:application/json;base64,${btoa(JSON.stringify(golJson))}`,
      unexpectedHttp,
    );

    expect(resolved?.name).toBe("Lifeform #1");
    expect(resolved?.image).toBe(image);
    expect(resolved?.attributes).toEqual([
      { traitType: "Status", value: "Alive" },
      { traitType: "Kind", value: "Loop" },
      { traitType: "Sequence Length", value: "3" },
      { traitType: "Age", value: "7" },
    ]);
  });

  test("reads a fully on-chain HTML animation (Game of Life v2 token_uri)", async () => {
    // Mirrors gol_metadata_v2::token_uri — a raw data:application/json document
    // whose art is an animation_url (base64 data:text/html) and which has NO image.
    const animationUrl = `data:text/html;base64,${btoa(
      "<!doctype html><html><body><canvas id='c'></canvas><script>/* conway */</script></body></html>",
    )}`;
    const golV2 = {
      animation_url: animationUrl,
      attributes: [
        { trait_type: "Status", value: "Alive" },
        { trait_type: "Kind", value: "Loop" },
      ],
      description: "An autonomous Conway's Game of Life lifeform living forever on Starknet.",
      name: "Lifeform 2924",
    };
    const resolved = await resolveNftMetadataUri(
      `data:application/json,${encodeURIComponent(JSON.stringify(golV2))}`,
      unexpectedHttp,
    );

    expect(resolved?.name).toBe("Lifeform 2924");
    expect(resolved?.image).toBe("");
    expect(resolved?.animationUrl).toBe(animationUrl);
  });

  test("fetches IPFS metadata through the fixed gateway without credentials", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const http: NftMetadataHttp = async (url, init) => {
      requestedUrl = url;
      requestedInit = init;
      return new Response(JSON.stringify(metadata), {
        headers: { "content-type": "application/json" },
      });
    };

    const resolved = await resolveNftMetadataUri("ipfs://bafybeigdyrzt/0.json", http);

    expect(requestedUrl).toBe("https://ipfs.io/ipfs/bafybeigdyrzt/0.json");
    expect(requestedInit).toMatchObject({
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(resolved?.image).toBe("https://ipfs.io/ipfs/bafybeigdyrzt/image.png");
  });

  test("fails closed for malformed, local, and over-large metadata", async () => {
    let fetched = false;
    const http: NftMetadataHttp = async () => {
      fetched = true;
      return new Response("{}");
    };

    await expect(resolveNftMetadataUri("data:application/json,%7Bbad", http)).resolves.toBeNull();
    await expect(resolveNftMetadataUri("https://127.0.0.1/meta.json", http)).resolves.toBeNull();
    await expect(
      resolveNftMetadataUri(`data:application/json,${"x".repeat(33_000)}`, http),
    ).resolves.toBeNull();
    expect(fetched).toBe(false);
  });
});
