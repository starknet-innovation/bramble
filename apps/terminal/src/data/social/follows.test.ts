import { describe, expect, it } from "vitest";
import { readFollowedAssets, toggleFollowedAsset } from "./follows";

describe("terminal follows", () => {
  it("persists validated token and perp follows and toggles them independently", () => {
    toggleFollowedAsset({
      id: "0x1",
      kind: "token",
      logoUri: null,
      name: "USD Coin",
      symbol: "USDC",
    });
    toggleFollowedAsset({
      id: "BTC-USD",
      kind: "perp",
      logoUri: "/token-assets/extended/BTC.svg",
      name: "BTC-USD",
      symbol: "BTC",
    });
    expect(readFollowedAssets()).toHaveLength(2);

    toggleFollowedAsset({
      id: "0x1",
      kind: "token",
      logoUri: null,
      name: "USD Coin",
      symbol: "USDC",
    });
    expect(readFollowedAssets().map((item) => item.kind)).toEqual(["perp"]);
  });
});
