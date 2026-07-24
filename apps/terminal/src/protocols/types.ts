/**
 * Shared protocol-integration types for the trade terminal. These are the
 * common shapes the five protocol modules (ekubo, avnu, vesu, privacy,
 * extended) speak in, so the sidepanel and background layers can treat swap,
 * lending, perps, and privacy quotes uniformly. All on-chain builders return
 * starknet-js `Call`s destined for the in-wallet invoke path
 * (submitInvokeTransaction), never the dapp-approval path.
 */
import type { Call } from "starknet";

/**
 * Identifiers for the wired protocol integrations.
 */
export type ProtocolId = "avnu" | "ekubo" | "extended" | "privacy" | "vesu";

/**
 * A token amount in the token's smallest on-chain unit. `address` is the ERC20
 * contract; `amount` is a decimal integer string (never a float) so it round
 * trips through felts without precision loss.
 */
export type TokenAmount = {
  readonly address: string;
  readonly amount: string;
};

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
export type LendingAction = "borrow" | "repay" | "supply" | "withdraw";

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

/**
 * A perpetual market as surfaced by the Extended exchange. Prices, sizes, and
 * rates are decimal strings as returned by the API; leverage is an integer.
 */
export type PerpMarketInfo = {
  readonly name: string;
  readonly baseAsset: string;
  readonly lastPrice: string;
  readonly fundingRate: string;
  readonly openInterest: string;
  readonly maxLeverage: number;
  readonly status: "ACTIVE" | "DELISTED" | "REDUCE_ONLY";
};

/**
 * Direction of a perp order.
 */
export type PerpOrderSide = "buy" | "sell";

/**
 * Inputs for signing a perp order. Extended settles off-chain, so this produces
 * a Stark-signed payload rather than an invoke `Call`.
 */
export type PerpOrderParams = {
  readonly market: string;
  readonly side: PerpOrderSide;
  readonly size: string;
  readonly price: string;
  readonly leverage: number;
  readonly reduceOnly?: boolean;
};

/**
 * A perp order payload plus its Stark sig (r, s), ready to POST to the exchange.
 */
export type SignedPerpOrder = {
  readonly market: string;
  readonly side: PerpOrderSide;
  readonly size: string;
  readonly price: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly sig: { readonly r: string; readonly s: string };
};

/**
 * The common on-chain protocol surface: a quote (read) and a call builder
 * (write) whose calls flow through the in-wallet invoke path. Ekubo, AVNU, and
 * Vesu conform to a specialization of this; privacy and extended settle
 * differently and expose their own module-level functions.
 */
export type OnchainProtocol<TQuoteParams, TQuote, TBuildParams> = {
  readonly id: ProtocolId;
  readonly quote: (params: TQuoteParams) => Promise<TQuote>;
  readonly buildCalls: (params: TBuildParams) => readonly Call[];
};

/**
 * Concrete swap-protocol surface (Ekubo, AVNU).
 */
export type SwapProtocol = OnchainProtocol<SwapQuoteParams, SwapQuote, SwapParams>;

/**
 * Concrete lending-protocol surface (Vesu).
 */
export type LendingProtocol = OnchainProtocol<LendingQuoteParams, LendingQuote, LendingParams>;
