import { describe, expect, it } from "vitest";
import { MAINNET_TOKEN_ADDRESSES } from "../protocols/index";
import { avnuTokenArtwork } from "./avnu-token-assets";

describe("avnuTokenArtwork", () => {
  it("prefers the bundled high-fidelity artwork for known addresses", () => {
    expect(avnuTokenArtwork(MAINNET_TOKEN_ADDRESSES.ETH, "https://remote/eth.png")).toBe(
      "/token-assets/avnu/0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7.svg",
    );
  });

  it("upgrades CoinGecko thumbnails when an asset is not in the local pack", () => {
    expect(
      avnuTokenArtwork(
        "0x123",
        "https://assets.coingecko.com/coins/images/325/small/Tether.png",
      ),
    ).toBe("https://assets.coingecko.com/coins/images/325/large/Tether.png");
  });

  it("returns null for invalid addresses with no provider artwork", () => {
    expect(avnuTokenArtwork("invalid", null)).toBeNull();
  });
});
