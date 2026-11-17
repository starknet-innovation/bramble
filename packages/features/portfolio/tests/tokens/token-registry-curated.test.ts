/**
 * isCuratedToken (audit 171): a dapp-added token stays trusted only when the
 * wallet already vouches for every field the review reads from it, so a real
 * curated contract under a site-supplied ticker, or the same contract and
 * ticker claimed on another network, is not curated.
 */
import { describe, expect, test } from "bun:test";
import { isCuratedToken, type SpamCandidate } from "@bramble/portfolio/token-registry";

const USDC: SpamCandidate = {
  address: "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
  decimals: 6,
  name: "USD Coin",
  networkId: "SN_MAIN",
  symbol: "USDC",
};

describe("isCuratedToken", () => {
  test("the exact curated mainnet token is curated", () => {
    expect(isCuratedToken(USDC)).toBe(true);
  });

  test("a curated contract under a site-supplied ticker is not curated", () => {
    expect(isCuratedToken({ ...USDC, symbol: "USDX" })).toBe(false);
  });

  test("the same contract and ticker on another network is not curated", () => {
    expect(isCuratedToken({ ...USDC, networkId: "SN_SEPOLIA" })).toBe(false);
    expect(isCuratedToken({ ...USDC, networkId: "SN_DEVNET" })).toBe(false);
  });
});
