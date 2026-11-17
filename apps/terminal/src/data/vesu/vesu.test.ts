import { describe, expect, it } from "vitest";
import { MAINNET_TOKEN_ADDRESSES } from "../../protocols/constants";
import {
  parseVesuMarkets,
  parseVesuPositions,
  parseVesuRewards,
  parseVesuVaults,
  vesuRiskUrl,
} from "./parse";

const POOL = "0x451fe483d5921a2919ddd81d0de6696669bccdacd859f72a4fba7656b97c3b5";
const VTOKEN = "0x38759a23ca9ac5a06df60b841175742df6b852e517b7c3476f0279419d84e65";

const fixed = (value: string, decimals = 18): { value: string; decimals: number } => ({
  decimals,
  value,
});

describe("Vesu V2 data boundary", () => {
  it("keeps only verified non-deprecated V2 markets and parses rate units", () => {
    const asset = {
      address: MAINNET_TOKEN_ADDRESSES.USDC,
      config: { feeRate: fixed("100000000000000000"), maxUtilization: fixed("950000000000000000") },
      decimals: 6,
      name: "USD Coin",
      oracleConfig: { numberOfSources: 3, pragmaKey: "USDC/USD", timeout: 3600 },
      risk: { url: "https://docs.vesu.xyz/risk" },
      stats: {
        borrowApr: fixed("80000000000000000"),
        canBeBorrowed: true,
        currentUtilization: fixed("750000000000000000"),
        supplyApy: fixed("50000000000000000"),
        totalDebt: fixed("750000", 6),
        totalSupplied: fixed("1000000", 6),
      },
      symbol: "USDC",
      usdPrice: fixed("1000000000000000000"),
      vToken: { address: VTOKEN },
      interestRateConfig: { targetUtilization: fixed("900000000000000000") },
    };
    const pool = {
      assets: [asset],
      id: POOL,
      isDeprecated: false,
      isPaused: false,
      isVerified: true,
      name: "Prime",
      oracleContractAddress: "0xfe4bfb1b353ba51eb34dff963017f94af5a5cf8bdf3dfc191c504657f3c05",
      owner: "0x1",
      pairs: [{
        collateralAssetAddress: MAINNET_TOKEN_ADDRESSES.ETH,
        debtAssetAddress: MAINNET_TOKEN_ADDRESSES.USDC,
        debtCap: fixed("1000000", 6),
        liquidationFactor: fixed("950000000000000000"),
        maxLTV: fixed("800000000000000000"),
      }],
      protocolVersion: "v2",
    };
    const parsed = parseVesuMarkets(
      {
        data: [
          pool,
          { ...pool, id: "0x2", isVerified: false },
          { ...pool, id: "0x3", protocolVersion: "v1" },
          { ...pool, id: "0x4", isDeprecated: true },
        ],
      },
      "2026-07-24T00:00:00.000Z",
    );

    expect(parsed.poolCount).toBe(1);
    expect(parsed.markets).toHaveLength(1);
    expect(parsed.pairs).toHaveLength(1);
    expect(parsed.markets[0]).toMatchObject({
      borrowApr: 8,
      liquidity: 0.25,
      supplyApy: 5,
      targetUtilization: 90,
      utilization: 75,
    });
    expect(parsed.pairs[0]?.maxLtv).toBe(80);
    expect(parsed.markets[0]?.riskUrl).toBe("https://docs.vesu.xyz/risk");
    const scripted = parseVesuMarkets(
      { data: [{ ...pool, assets: [{ ...asset, risk: { url: "javascript:alert(1)" } }] }] },
      "2026-07-24T00:00:00.000Z",
    );
    expect(scripted.markets[0]?.riskUrl).toBeNull();
  });

  it("keeps a risk-report link only when it is a plain https URL (Sherlock 206)", () => {
    for (const unsafe of [
      "javascript:alert(document.domain)",
      "data:text/html,<script>alert(1)</script>",
      "http://docs.vesu.xyz/risk",
      "https://docs.vesu.xyz@evil.example/risk",
      "https://user:pass@evil.example/",
      `https://docs.vesu.xyz/${"a".repeat(2_048)}`,
      "not a url",
      42,
      null,
    ]) {
      expect(vesuRiskUrl(unsafe)).toBeNull();
    }
    expect(vesuRiskUrl("https://risk.example/report?pool=1")).toBe(
      "https://risk.example/report?pool=1",
    );
  });

  it("normalizes earn/borrow positions and ignores V1 or malformed rows", () => {
    const parsed = parseVesuPositions({
      data: [
        {
          collateral: {
            address: MAINNET_TOKEN_ADDRESSES.ETH,
            decimals: 18,
            symbol: "ETH",
            value: "2000000000000000000",
          },
          debt: {
            address: MAINNET_TOKEN_ADDRESSES.USDC,
            decimals: 6,
            symbol: "USDC",
            value: "1000000",
          },
          healthFactor: fixed("1800000000000000000"),
          id: "position-1",
          ltv: { current: fixed("500000000000000000"), max: fixed("800000000000000000") },
          pool: { id: POOL, name: "Prime" },
          protocolVersion: "v2",
          type: "borrow",
        },
        {
          collateral: { address: MAINNET_TOKEN_ADDRESSES.ETH, decimals: 18, symbol: "ETH", value: "1" },
          pool: { id: POOL, name: "Old" },
          protocolVersion: "v1",
          type: "earn",
        },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      collateralAmount: 2,
      currentLtv: 50,
      debtAmount: 1,
      healthFactor: 1.8,
      maxLtv: 80,
      type: "borrow",
    });
  });

  it("parses curated vault and reward payloads", () => {
    const vaults = parseVesuVaults({
      data: [{
        address: "0x123",
        curatorAddress: "0x456",
        depositLimit: fixed("100000000", 6),
        fees: { management: fixed("10000000000000000"), performance: fixed("100000000000000000") },
        name: "USDC Pro",
        stats: {
          apr: { sevenDays: fixed("50000000000000000"), thirtyDays: fixed("40000000000000000") },
          averageRedeemDelay: 3600,
          tvl: { usd: fixed("250000000000000000000000") },
        },
        symbol: "vUSDC",
        underlyingAsset: {
          address: MAINNET_TOKEN_ADDRESSES.USDC,
          decimals: 6,
          symbol: "USDC",
        },
      }],
    });
    expect(vaults[0]).toMatchObject({ apr7d: 5, managementFee: 1, tvlUsd: 250000 });
    expect(
      parseVesuRewards(
        { data: { btcFi: { amount: "10", decimals: 18 } } },
        { data: { btcFi: { amount: "7", proof: ["0x1"] } } },
      ),
    ).toEqual({ amount: "10", claimableRaw: "7", decimals: 18, proof: ["0x1"] });
    expect(
      parseVesuRewards(
        { data: { btcFi: { amount: "not-an-integer", decimals: 99 } } },
        { data: { btcFi: { amount: "-1", proof: ["invalid", "0x2"] } } },
      ),
    ).toEqual({ amount: "0", claimableRaw: "0", decimals: 18, proof: ["0x2"] });
  });
});
