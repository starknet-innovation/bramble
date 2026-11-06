import { describe, expect, test } from "vitest";
import { buildTokenDeployment } from "./token-create";
import {
  erc1155IdText,
  isPublicTokenUri,
  isSharedErc1155Uri,
  metadataFileName,
  readBaseUri,
  resolveTokenUri,
} from "./token-uri";

const BIG_ID = (1n << 255n) + 7n;

describe("isPublicTokenUri", () => {
  test("accepts public https hosts and ipfs paths", () => {
    expect(isPublicTokenUri("https://example.org/meta/", 200)).toBe(true);
    expect(isPublicTokenUri("https://cdn.example.org./a.png", 200)).toBe(true);
    expect(isPublicTokenUri("ipfs://bafybeigdyrzt/1.png", 200)).toBe(true);
    expect(isPublicTokenUri("ipfs://ipfs/QmYwAPJzv5CZsnA/{id}.json", 200)).toBe(true);
    expect(isPublicTokenUri("ipfs://bafybeigdyrzt", 200)).toBe(true);
  });

  test("refuses hosts the wallet would never read, credentials, and other schemes", () => {
    for (const uri of [
      "http://example.org/",
      "ipfs://",
      "ipfs:///",
      "ipfs://?",
      "ipfs://{id}",
      "ipfs://-cid/",
      "https://localhost/meta/",
      "https://shop.localhost/meta/",
      "https://printer.local/meta/",
      "https://127.0.0.1/meta/",
      "https://10.0.0.8/meta/",
      "https://[::1]/meta/",
      "https://intranet/meta/",
      "https://user:pw@example.org/meta/",
      "https://user@example.org/meta/",
      "https://example.org/a b",
      "data:application/json,{}",
      "javascript:alert(1)",
      "https://exa%mple.org/",
    ]) {
      expect(isPublicTokenUri(uri, 200), uri).toBe(false);
    }
  });

  test("holds the length cap", () => {
    const uri = `https://example.org/${"a".repeat(180)}`;
    expect(isPublicTokenUri(uri, uri.length)).toBe(true);
    expect(isPublicTokenUri(uri, uri.length - 1)).toBe(false);
  });
});

describe("readBaseUri", () => {
  test("trims a valid base URI", () => {
    expect(readBaseUri("  ipfs://bafy/  ", "erc721")).toBe("ipfs://bafy/");
    expect(readBaseUri("https://example.org/{id}.json", "erc1155")).toBe("https://example.org/{id}.json");
  });

  test("refuses a private host and an ERC-721 {id}", () => {
    expect(() => readBaseUri("https://192.168.1.4/meta/", "erc721")).toThrow(
      "Base URI must be a public https:// or ipfs:// address, with no spaces, up to 200 characters.",
    );
    expect(() => readBaseUri("ipfs://bafy/{id}", "erc721")).toThrow(
      "An ERC-721 base URI can't contain {id}. The token id is added to the end.",
    );
  });

  test("Create refuses the same base URIs before any calldata exists", () => {
    const draft = {
      baseUri: "https://localhost/meta/",
      name: "Garden",
      recipient: "0x456",
      standard: "erc721" as const,
      symbol: "GRDN",
      tokenIds: "1",
    };
    expect(() => buildTokenDeployment(draft, "0x123", "0x77")).toThrow("public https:// or ipfs://");
    expect(() => buildTokenDeployment({ ...draft, baseUri: "ipfs://bafy/{id}" }, "0x123", "0x77")).toThrow(
      "can't contain {id}",
    );
  });
});

describe("resolveTokenUri", () => {
  // Matches the pinned presets on Sepolia: token_uri(7) returned
  // "ipfs://bafysim/7" and uri(7) returned the base URI unchanged.
  test("ERC-721 appends the id in decimal", () => {
    expect(resolveTokenUri("erc721", "ipfs://bafysim/", 7n)).toBe("ipfs://bafysim/7");
    expect(resolveTokenUri("erc721", "https://example.org/meta/", BIG_ID)).toBe(
      `https://example.org/meta/${BIG_ID.toString()}`,
    );
  });

  test("ERC-1155 replaces {id} with 64 lowercase hex digits", () => {
    expect(erc1155IdText(255n)).toBe(`${"0".repeat(62)}ff`);
    expect(resolveTokenUri("erc1155", "https://example.org/meta/{id}.json", 255n)).toBe(
      `https://example.org/meta/${"0".repeat(62)}ff.json`,
    );
    expect(resolveTokenUri("erc1155", "ipfs://bafy/{id}/{id}", 1n)).toBe(
      `ipfs://bafy/${"0".repeat(63)}1/${"0".repeat(63)}1`,
    );
    expect(resolveTokenUri("erc1155", "ipfs://bafy/shared.json", 9n)).toBe("ipfs://bafy/shared.json");
    expect(isSharedErc1155Uri("ipfs://bafy/shared.json")).toBe(true);
    expect(isSharedErc1155Uri("ipfs://bafy/{id}.json")).toBe(false);
  });
});

describe("metadataFileName", () => {
  test("uses the URI's last segment when it is a plain file name", () => {
    expect(metadataFileName("ipfs://bafy/7", 7n)).toBe("7");
    expect(metadataFileName(`https://example.org/meta/${"0".repeat(63)}1.json?v=2#x`, 1n)).toBe(
      `${"0".repeat(63)}1.json`,
    );
  });

  test("falls back to <id>.json otherwise", () => {
    expect(metadataFileName(null, 7n)).toBe("7.json");
    expect(metadataFileName("https://example.org/", 7n)).toBe("7.json");
    expect(metadataFileName("https://example.org/meta/..", 7n)).toBe("7.json");
    expect(metadataFileName("https://example.org/a%20b", 7n)).toBe("7.json");
  });
});
