/**
 * `isDefaultToken` decides which tracked tokens can't be removed (Sherlock
 * audit 134). It matches by network and numeric address, so a built-in
 * address only counts on a network that ships it.
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TOKENS,
  isDefaultToken,
  RECOVERY_PROBE_TOKENS,
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

describe("RECOVERY_PROBE_TOKENS", () => {
  test("is a superset of the display defaults", () => {
    for (const token of DEFAULT_TOKENS) {
      expect(
        RECOVERY_PROBE_TOKENS.some(
          (probe) => probe.networkId === token.networkId && sameFelt(probe.address, token.address),
        ),
      ).toBe(true);
    }
  });

  test("adds native USDC on mainnet as a discovery-only activity signal", () => {
    const usdc = RECOVERY_PROBE_TOKENS.find(
      (token) => token.networkId === "SN_MAIN" && token.symbol === "USDC",
    );
    expect(usdc).toBeDefined();
    expect(sameFelt(usdc?.address ?? "", USDC_TOKEN_ADDRESS)).toBe(true);
    expect(usdc?.decimals).toBe(6);
    // Widening discovery must not change what every wallet shows by default.
    expect(isDefaultToken({ address: USDC_TOKEN_ADDRESS, networkId: "SN_MAIN" })).toBe(false);
  });
});
