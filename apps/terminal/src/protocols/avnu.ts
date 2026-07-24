/**
 * AVNU integration — DEX aggregator routing across many AMMs. `quoteSwap` asks the
 * AVNU quotes API (AVNU_API.base) for the best multi-venue route, then the build
 * API for that route's prebuilt `multi_route_swap` calldata; `buildSwapCalls`
 * assembles the approve -> `multi_route_swap` multicall (spender =
 * AVNU_ADDRESSES.exchange) for the in-wallet invoke path. No @avnu/avnu-sdk — the
 * REST endpoints are called directly and the calls are assembled with the vendored
 * starknet-js. Route shapes, the REST client, and the pure builders live in
 * ./avnu-swap; this module is the thin public protocol surface.
 *
 * The exchange address is pinned to AVNU's published mainnet contract reference.
 * These builders never broadcast; they only produce `Call`s for wallet review.
 */
import type { Call } from "starknet";
import { WalletError } from "./support/errors";
import { isNonZeroStarkFieldElement } from "./support/networks";
import {
  type AvnuRoute,
  applySlippageFloor,
  buildApproveCall,
  DEFAULT_SLIPPAGE_BPS,
  fetchAvnuExchangeCall,
  fetchAvnuQuote,
  isAvnuRoute,
  slippageToFraction,
  toExchangeCall,
} from "./avnu-swap";
import { AVNU_API } from "./constants";
import type { SwapParams, SwapQuote, SwapQuoteParams } from "./types";

/**
 * AVNU protocol id for tagging quotes and routing.
 */
export const AVNU_PROTOCOL_ID = "avnu" as const;

/**
 * Fetches the best aggregated swap route from the AVNU API and its slippage-bounded
 * `multi_route_swap` calldata, returning a SwapQuote whose opaque `route` carries
 * everything the synchronous buildSwapCalls needs to reproduce the trade.
 */
export const quoteSwap = async (params: SwapQuoteParams): Promise<SwapQuote> => {
  if (
    !isNonZeroStarkFieldElement(params.sellToken) ||
    !isNonZeroStarkFieldElement(params.buyToken)
  ) {
    throw new WalletError("Invalid AVNU swap token");
  }
  if (!isNonZeroStarkFieldElement(params.takerAddress)) {
    throw new WalletError("Invalid AVNU taker address");
  }
  const slippageBps = params.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const quote = await fetchAvnuQuote(AVNU_API.base, {
    buyToken: params.buyToken,
    sellAmount: params.sellAmount,
    sellToken: params.sellToken,
    takerAddress: params.takerAddress,
  });
  // The build API bakes `buy_token_min_amount` (the on-chain slippage floor) into
  // the returned calldata, so slippage is bound here at quote time.
  const exchangeCall = await fetchAvnuExchangeCall(AVNU_API.base, {
    includeApprove: false,
    quoteId: quote.quoteId,
    slippage: slippageToFraction(slippageBps),
    takerAddress: params.takerAddress,
  });
  const route: AvnuRoute = {
    buyAmount: quote.buyAmount,
    buyToken: params.buyToken,
    exchangeCall,
    protocol: "avnu",
    quoteId: quote.quoteId,
    sellAmount: quote.sellAmount,
    sellToken: params.sellToken,
  };
  return {
    buyAmount: quote.buyAmount,
    buyToken: params.buyToken,
    gasFeesInUsd: quote.gasFeesInUsd,
    minBuyAmount: applySlippageFloor(BigInt(quote.buyAmount), slippageBps).toString(),
    priceImpactBps: quote.priceImpactBps,
    protocol: AVNU_PROTOCOL_ID,
    route,
    routeLabels: quote.routeLabels,
    sellAmount: quote.sellAmount,
    sellToken: params.sellToken,
  };
};

/**
 * Builds the AVNU approve + `multi_route_swap` multicall from a quoted route. The
 * `slippageBps` on `params` is ignored: slippage was already bound into the quoted
 * calldata by quoteSwap. Because this is synchronous with no RPC access it cannot
 * read the current allowance, so it always emits an approve for exactly the sell
 * amount; the router pulls only what the swap spends, leaving no lingering
 * allowance.
 */
export const buildSwapCalls = (params: SwapParams): readonly Call[] => {
  const { route } = params.quote;
  if (!isAvnuRoute(route)) {
    throw new WalletError("Invalid AVNU route");
  }
  return [buildApproveCall(route.sellToken, BigInt(route.sellAmount)), toExchangeCall(route)];
};
