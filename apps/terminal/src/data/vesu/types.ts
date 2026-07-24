/** Normalized, display-safe Vesu V2 market data. */
export type VesuMarket = {
  readonly poolId: string;
  readonly poolName: string;
  readonly poolOwner: string;
  readonly oracleAddress: string;
  readonly isPaused: boolean;
  readonly assetAddress: string;
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly vTokenAddress: string;
  readonly priceUsd: number;
  readonly supplied: number;
  readonly debt: number;
  readonly liquidity: number;
  readonly supplyApy: number;
  readonly borrowApr: number;
  readonly utilization: number;
  readonly targetUtilization: number;
  readonly minTargetUtilization: number;
  readonly maxTargetUtilization: number;
  readonly maxUtilization: number;
  readonly zeroUtilizationApr: number;
  readonly fullUtilizationApr: number;
  readonly minFullUtilizationApr: number;
  readonly maxFullUtilizationApr: number;
  readonly targetRatePercent: number;
  readonly rateHalfLifeSeconds: number;
  readonly rateUpdatedAt: string | null;
  readonly feeRate: number;
  readonly oracleKey: string;
  readonly oracleSources: number;
  readonly oracleTimeoutSeconds: number;
  readonly oracleAggregationMode: string;
  readonly oracleTimeWindowSeconds: number;
  readonly riskUrl: string | null;
  readonly canBeBorrowed: boolean;
};

/** A borrow pair supported by a verified Vesu V2 pool. */
export type VesuPair = {
  readonly poolId: string;
  readonly collateralAddress: string;
  readonly debtAddress: string;
  readonly maxLtv: number;
  readonly liquidationFactor: number;
  readonly debtCap: number;
};

/** Parsed Vesu pool inventory for the professional lending desk. */
export type VesuMarketsData = {
  readonly markets: readonly VesuMarket[];
  readonly pairs: readonly VesuPair[];
  readonly poolCount: number;
  readonly syncedAt: string;
};

/** Open Vesu lending or vault position belonging to the connected wallet. */
export type VesuPosition = {
  readonly id: string;
  readonly type: "borrow" | "earn" | "multiply" | "vault";
  readonly poolId: string;
  readonly poolName: string;
  readonly collateralAddress: string;
  readonly collateralSymbol: string;
  readonly collateralDecimals: number;
  readonly collateralAmount: number;
  readonly collateralRaw: string;
  readonly debtAddress: string | null;
  readonly debtSymbol: string | null;
  readonly debtDecimals: number | null;
  readonly debtAmount: number;
  readonly debtRaw: string | null;
  readonly currentLtv: number | null;
  readonly maxLtv: number | null;
  readonly healthFactor: number | null;
  readonly sharesAmount: number | null;
  readonly sharesDecimals: number | null;
  readonly sharesRaw: string | null;
  readonly sharesSymbol: string | null;
};

/** A curated Vesu vault available to depositors. */
export type VesuVault = {
  readonly address: string;
  readonly name: string;
  readonly symbol: string;
  readonly assetAddress: string;
  readonly assetSymbol: string;
  readonly assetDecimals: number;
  readonly curatorAddress: string;
  readonly tvlUsd: number;
  readonly apr7d: number;
  readonly apr30d: number;
  readonly managementFee: number;
  readonly performanceFee: number;
  readonly depositLimit: number;
  readonly averageRedeemDelaySeconds: number;
};

/** Claimable Vesu incentive payload. */
export type VesuRewards = {
  readonly amount: string;
  readonly decimals: number;
  readonly claimableRaw: string;
  readonly proof: readonly string[];
};

/** An asynchronous Vesu vault redemption and its current epoch status. */
export type VesuRedeem = {
  readonly assetsAmount: number;
  readonly assetsSymbol: string;
  readonly redemptionId: string;
  readonly sharesAddress: string;
  readonly sharesAmount: number;
  readonly sharesDecimals: number;
  readonly sharesSymbol: string;
  readonly status: "claimable" | "claimed" | "pending";
  readonly timestamp: string;
};
