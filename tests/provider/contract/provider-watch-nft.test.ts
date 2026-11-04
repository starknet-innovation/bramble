/**
 * wallet_watchAsset for collectibles, ahead of the Starknet wallet API: the
 * bridge maps an EIP-747-shaped ERC721/ERC1155 asset to the watch-asset
 * runtime message with a canonical decimal token id, and refuses anything
 * else. A site's image or name is accepted and dropped.
 */
import { describe, expect, test } from "bun:test";
import { toRuntimeMessage } from "@bramble/wallet-protocol/bridge";
import { isProviderWatchNft, readProviderWatchNft } from "@bramble/wallet-protocol/watch-asset";

const CONTRACT = "0x0511a2b3c4d5e6f";
const params = (type: string, tokenId: unknown, extra: Record<string, unknown> = {}) => ({
  options: { address: CONTRACT, tokenId, ...extra },
  type,
});

describe("collectible watch-asset params", () => {
  test("reads ERC721 and ERC1155 assets with a decimal or hex token id", () => {
    expect(readProviderWatchNft(params("ERC721", "42"))).toEqual({
      address: CONTRACT,
      standard: "ERC721",
      tokenId: "42",
    });
    expect(
      readProviderWatchNft(params("ERC1155", "0x2a", { image: "https://x/y.png", name: "Hero" })),
    ).toEqual({ address: CONTRACT, standard: "ERC1155", tokenId: "42" });
    expect(readProviderWatchNft({ ...params("ERC721", "1"), api_version: "0.8" })).not.toBeNull();
  });

  test("refuses ids outside u256, other types, extra keys and bad options", () => {
    const max = (2n ** 256n - 1n).toString();
    expect(readProviderWatchNft(params("ERC721", max))?.tokenId).toBe(max);
    for (const bad of [
      params("ERC721", (2n ** 256n).toString()),
      params("ERC721", "-1"),
      params("ERC721", "1.5"),
      params("ERC721", 7),
      params("ERC721", ""),
      params("ERC721", `0x${"f".repeat(65)}`),
      params("ERC20", "1"),
      params("ERC721", "1", { image: 3 }),
      params("ERC721", "1", { decimals: 0 }),
      { ...params("ERC721", "1"), extra: true },
      { options: { address: "0x0", tokenId: "1" }, type: "ERC721" },
      { type: "ERC721" },
    ]) {
      expect(readProviderWatchNft(bad)).toBeNull();
    }
  });

  test("re-validates the runtime copy as canonical decimal only", () => {
    expect(isProviderWatchNft({ address: CONTRACT, standard: "ERC721", tokenId: "42" })).toBe(true);
    expect(isProviderWatchNft({ address: CONTRACT, standard: "ERC721", tokenId: "042" })).toBe(
      false,
    );
    expect(isProviderWatchNft({ address: CONTRACT, standard: "ERC721", tokenId: "0x2a" })).toBe(
      false,
    );
    expect(isProviderWatchNft({ address: CONTRACT, standard: "ERC777", tokenId: "1" })).toBe(false);
  });

  test("the bridge maps a collectible to the watch-asset runtime message", () => {
    expect(
      toRuntimeMessage(
        { id: "1", method: "wallet_watchAsset", params: params("ERC721", "0x2a") },
        "https://a.test",
      ),
    ).toEqual({
      nft: { address: CONTRACT, standard: "ERC721", tokenId: "42" },
      origin: "https://a.test",
      type: "wallet.watchAsset",
    });
    expect(
      toRuntimeMessage(
        { id: "1", method: "wallet_watchAsset", params: params("ERC721", "x") },
        "https://a.test",
      ),
    ).toBeNull();
  });
});
