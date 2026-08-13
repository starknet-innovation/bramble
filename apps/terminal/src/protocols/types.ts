/**
 * Shared protocol-integration types for the trade terminal. These are the
 * common shapes the live Ekubo, AVNU, and Vesu integrations speak in.
 */
type ProtocolId = "avnu" | "ekubo";

/**
 * Inputs shared by every swap quote request: the pair, the exact input amount,
 * the taker account, and an optional slippage tolerance in basis points.
 */
export type SwapQuoteParams = {
  readonly sellToken: string;
  readonly buyToken: string;
  readonly sellAmount: string;
  readonly takerAddress: string;
  readonly slippageBps?: number;
};

/**
 * A priced swap route returned by a quote call. `buyAmount` is the expected
 * output and `minBuyAmount` the slippage-protected floor, both in the buy
 * token's smallest unit. `route` is an opaque, protocol-specific token the
 * matching `buildSwapCalls` consumes to reproduce the quoted trade.
 */
export type SwapQuote = {
  readonly protocol: ProtocolId;
  readonly sellToken: string;
  readonly buyToken: string;
  readonly sellAmount: string;
  readonly buyAmount: string;
  readonly minBuyAmount: string;
  /** AVNU's estimated network fee in STRK smallest units, when supplied. */
  readonly gasFeesInStrk?: string | null;
  /** AVNU's estimated network fee in USD, when supplied by the route. */
  readonly gasFeesInUsd?: number | null;
  /** Route price impact in basis points, when supplied by the venue. */
  readonly priceImpactBps?: number | null;
  /** Human-readable liquidity sources contributing to the route. */
  readonly routeLabels?: readonly string[];
  readonly route: unknown;
};

/**
 * Inputs for building the on-chain calls that execute a previously fetched
 * quote for a given account.
 */
export type SwapParams = {
  readonly quote: SwapQuote;
  readonly takerAddress: string;
  readonly slippageBps?: number;
};

/**
 * The lending actions Vesu exposes: supply for yield, withdraw supply, borrow
 * against collateral, repay debt.
 */
type LendingAction = "borrow" | "repay" | "supply" | "withdraw";

/**
 * Inputs for a lending quote: which action, which asset and amount, on which
 * pool, for which account. In Vesu V2 `poolId` is the `Pool` contract address
 * (each pool is its own contract). A V2 position is keyed by the
 * (collateral_asset, debt_asset, user) triple, so borrow/repay additionally
 * carry the collateral leg: `collateralAsset` is the asset that keys the
 * position, and `collateralAmount` is the smallest-unit amount of collateral to
 * supply alongside the borrow (a decimal integer string; "0" means "do not add
 * collateral", e.g. borrowing against an existing position or repaying). Both
 * are optional here because supply/withdraw (earn) do not use them.
 */
export type LendingQuoteParams = {
  readonly action: LendingAction;
  readonly asset: string;
  readonly amount: string;
  readonly poolId: string;
  readonly accountAddress: string;
  readonly collateralAsset?: string;
  readonly collateralAmount?: string;
};

/**
 * A lending quote: the resolved pool contract address plus the projected
 * position figures (all in smallest units / basis points) a review screen
 * shows before the user commits. In V2 `poolAddress` is the `Pool` contract the
 * borrow/repay `modify_position` call targets. `collateralAsset` /
 * `collateralAmount` echo the borrow/repay collateral leg (null for earn).
 */
export type LendingQuote = {
  readonly action: LendingAction;
  readonly asset: string;
  readonly amount: string;
  readonly poolId: string;
  readonly poolAddress: string;
  readonly collateralAsset: string | null;
  readonly collateralAmount: string | null;
  readonly vTokenAddress: string | null;
  readonly supplyApyBps: number | null;
  readonly borrowApyBps: number | null;
};

/**
 * Inputs for building the on-chain calls that execute a lending quote.
 */
export type LendingParams = {
  readonly quote: LendingQuote;
  readonly accountAddress: string;
};
