import type { VesuMarket, VesuPair } from "../data";
import { sameAddress } from "../protocols/support/networks";

export type LendingView = "markets" | "positions" | "rewards" | "vaults";
export type LendingActionMode = "borrow" | "multiply" | "repay" | "supply" | "withdraw";
export type LendingSort = "apy" | "borrow" | "liquidity" | "utilization";

/** Stable row key for the same asset listed in multiple isolated pools. */
export const lendingMarketKey = (market: VesuMarket): string =>
  `${market.poolId}:${market.assetAddress}`;

/** Applies the professional desk's search, pool, and risk filters. */
export const filterVesuMarkets = (
  markets: readonly VesuMarket[],
  search: string,
  pool: string,
  borrowableOnly: boolean,
  sort: LendingSort,
): readonly VesuMarket[] => {
  const needle = search.trim().toLowerCase();
  return markets
    .filter(
      (market) =>
        (pool === "all" || market.poolId === pool) &&
        (!borrowableOnly || market.canBeBorrowed) &&
        (needle === "" ||
          market.symbol.toLowerCase().includes(needle) ||
          market.name.toLowerCase().includes(needle) ||
          market.poolName.toLowerCase().includes(needle)),
    )
    .sort((left, right) => {
      if (sort === "borrow") return left.borrowApr - right.borrowApr;
      if (sort === "liquidity") return right.liquidity * right.priceUsd - left.liquidity * left.priceUsd;
      if (sort === "utilization") return right.utilization - left.utilization;
      return right.supplyApy - left.supplyApy;
    });
};

/** Resolves borrow collateral choices for the selected debt market and pool. */
export const collateralMarketsFor = (
  debtMarket: VesuMarket,
  markets: readonly VesuMarket[],
  pairs: readonly VesuPair[],
): readonly { readonly market: VesuMarket; readonly pair: VesuPair }[] =>
  pairs
    .filter(
      (pair) =>
        pair.poolId === debtMarket.poolId &&
        sameAddress(pair.debtAddress, debtMarket.assetAddress),
    )
    .flatMap((pair) => {
      const market = markets.find(
        (candidate) =>
          candidate.poolId === pair.poolId &&
          sameAddress(candidate.assetAddress, pair.collateralAddress),
      );
      return market === undefined ? [] : [{ market, pair }];
    })
    .sort((left, right) => right.pair.maxLtv - left.pair.maxLtv);

/** Preserves the exact position collateral when opening a manage ticket. */
export const resolveCollateralAddress = (
  choices: readonly { readonly market: VesuMarket }[],
  current: string,
  requested: string,
): string => {
  const requestedChoice = choices.find(
    (choice) => requested !== "" && sameAddress(choice.market.assetAddress, requested),
  );
  if (requestedChoice !== undefined) return requestedChoice.market.assetAddress;
  const currentChoice = choices.find((choice) =>
    sameAddress(choice.market.assetAddress, current),
  );
  return currentChoice?.market.assetAddress ?? choices[0]?.market.assetAddress ?? "";
};

/** Returns a bounded projected LTV using current API prices. */
export const projectedLtv = (
  collateralAmount: number,
  collateralPrice: number,
  debtAmount: number,
  debtPrice: number,
): number => {
  const collateralUsd = collateralAmount * collateralPrice;
  if (collateralUsd <= 0) return 0;
  return (debtAmount * debtPrice * 100) / collateralUsd;
};

/** Compact risk band for utilization and collateral health. */
export const riskTone = (value: number, warning: number, danger: number): "danger" | "safe" | "warn" =>
  value >= danger ? "danger" : value >= warning ? "warn" : "safe";

/** Converts raw integer token units to a concise decimal display. */
export const rawTokenAmount = (raw: string, decimals: number): string => {
  const padded = raw.padStart(decimals + 1, "0");
  const integer = padded.slice(0, -decimals) || "0";
  const fraction = decimals === 0 ? "" : padded.slice(-decimals).replace(/0+$/, "").slice(0, 6);
  return fraction === "" ? integer : `${integer}.${fraction}`;
};
