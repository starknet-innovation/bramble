import { describe, expect, it } from "vitest";
import type { TokenRow } from "../data";
import { collapseDiscoverTokenRepresentations } from "./discover-data";

const token = (name: string, symbol: string, address: string): TokenRow => ({
  address,
  change24h: 0,
  decimals: 6,
  liquidityUsd: 1,
  logoUri: null,
  marketCapUsd: 50_000_000_000,
  name,
  priceUsd: 1,
  symbol,
  volume24hUsd: 1,
});

describe("Discover token ranking", () => {
  it("collapses native and bridged USDC while preferring native USDC", () => {
    const rows = collapseDiscoverTokenRepresentations([
      token("Bridged USDC", "USDC.e", "0x1"),
      token("Ether", "ETH", "0x2"),
      token("USD Coin", "USDC", "0x3"),
    ]);

    expect(rows.map((row) => row.name)).toEqual(["Ether", "USD Coin"]);
  });

  it("does not collapse arbitrary tokens that happen to share a symbol", () => {
    const rows = collapseDiscoverTokenRepresentations([
      token("Alpha", "ABC", "0x1"),
      token("Beta", "ABC", "0x2"),
    ]);

    expect(rows).toHaveLength(2);
  });
});
