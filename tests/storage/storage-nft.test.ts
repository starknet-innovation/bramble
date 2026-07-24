/**
 * Watched-NFT validator checks: canonical ids, optional label/spam fields, and
 * rejection of malformed records.
 */
import { describe, expect, test } from "bun:test";
import { isWatchedNft, withNftId } from "../../src/storage/nft";

const CONTRACT = "0x051a2b3c4d";

describe("watched NFT helpers", () => {
  test("normalizes contract, token id, and derives a deterministic id", () => {
    const nft = withNftId({ contract: CONTRACT, networkId: "SN_MAIN", tokenId: "007" });
    expect(nft.contract).toBe("0x51a2b3c4d");
    expect(nft.tokenId).toBe("7");
    expect(nft.id).toBe(`SN_MAIN:${nft.contract}:7`);
    expect(isWatchedNft(nft)).toBe(true);
  });

  test("keeps optional label and spam flag when provided", () => {
    const nft = withNftId({
      contract: CONTRACT,
      label: "  Punk  ",
      networkId: "SN_SEPOLIA",
      spam: true,
      tokenId: "42",
    });
    expect(nft.label).toBe("Punk");
    expect(nft.spam).toBe(true);
    expect(isWatchedNft(nft)).toBe(true);
  });

  test("rejects malformed records", () => {
    expect(isWatchedNft({ contract: "0x0", id: "x", networkId: "SN_MAIN", tokenId: "1" })).toBe(
      false,
    );
    expect(
      isWatchedNft({
        contract: CONTRACT,
        id: "SN_MAIN:wrong:1",
        networkId: "SN_MAIN",
        tokenId: "1",
      }),
    ).toBe(false);
    expect(
      isWatchedNft({ contract: CONTRACT, id: "x", networkId: "SN_MAIN", tokenId: "1.5" }),
    ).toBe(false);
  });
});
