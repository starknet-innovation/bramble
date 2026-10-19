/**
 * `isDefaultToken` decides which tracked tokens can't be removed (Sherlock
 * audit 134). It matches by network and numeric address, so a built-in
 * address only counts on a network that ships it.
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TOKENS,
  DEFAULT_TRACKED_TOKENS,
  isDefaultToken,
  isDefaultTrackedToken,
  sameFelt,
  USDC_TOKEN_ADDRESS,
} from "@bramble/wallet-model/networks";

const ETH_TOKEN_ADDRESS =
  DEFAULT_TOKENS.find((token) => token.networkId === "SN_MAIN" && token.symbol === "ETH")
    ?.address ?? "";

describe("isDefaultToken", () => {
  test("matches a built-in token by network and any spelling of its address", () => {
    expect(isDefaultToken({ address: ETH_TOKEN_ADDRESS, networkId: "SN_MAIN" })).toBe(true);
    const unpadded = `0x${BigInt(ETH_TOKEN_ADDRESS).toString(16)}`;
    expect(isDefaultToken({ address: unpadded, networkId: "SN_SEPOLIA" })).toBe(true);
  });

  test("does not match a built-in address on a network that does not ship it", () => {
    expect(isDefaultToken({ address: ETH_TOKEN_ADDRESS, networkId: "SN_CUSTOM" })).toBe(false);
  });

  test("does not match another address on a built-in network", () => {
    expect(isDefaultToken({ address: "0xbadc0ffee", networkId: "SN_MAIN" })).toBe(false);
  });
});

describe("DEFAULT_TRACKED_TOKENS as the recovery probe", () => {
  test("is a superset of the display defaults", () => {
    for (const token of DEFAULT_TOKENS) {
      expect(
        DEFAULT_TRACKED_TOKENS.some(
          (probe) => probe.networkId === token.networkId && sameFelt(probe.address, token.address),
        ),
      ).toBe(true);
    }
  });

  test("adds native USDC on mainnet as an activity signal", () => {
    const usdc = DEFAULT_TRACKED_TOKENS.find(
      (token) => token.networkId === "SN_MAIN" && token.symbol === "USDC",
    );
    expect(usdc).toBeDefined();
    expect(sameFelt(usdc?.address ?? "", USDC_TOKEN_ADDRESS)).toBe(true);
    expect(usdc?.decimals).toBe(6);
    // USDC is tracked on new wallets (issue 663) but is not a built-in.
    expect(isDefaultToken({ address: USDC_TOKEN_ADDRESS, networkId: "SN_MAIN" })).toBe(false);
  });
});

describe("DEFAULT_TRACKED_TOKENS (issue 663)", () => {
  test("is the built-ins plus native USDC on mainnet only", () => {
    const extra = DEFAULT_TRACKED_TOKENS.filter(
      (token) =>
        !DEFAULT_TOKENS.some(
          (known) => known.networkId === token.networkId && sameFelt(known.address, token.address),
        ),
    );
    expect(extra).toEqual([
      {
        address: USDC_TOKEN_ADDRESS,
        decimals: 6,
        name: "USD Coin",
        networkId: "SN_MAIN",
        symbol: "USDC",
      },
    ]);
  });

  test("names native Circle USDC, not bridged USDC.e", () => {
    expect(USDC_TOKEN_ADDRESS).toBe(
      "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
    );
  });

  test("USDC is seeded but removable, and only on mainnet", () => {
    expect(isDefaultTrackedToken({ address: USDC_TOKEN_ADDRESS, networkId: "SN_MAIN" })).toBe(true);
    expect(isDefaultTrackedToken({ address: USDC_TOKEN_ADDRESS, networkId: "SN_SEPOLIA" })).toBe(
      false,
    );
    expect(isDefaultToken({ address: USDC_TOKEN_ADDRESS, networkId: "SN_MAIN" })).toBe(false);
  });
});
