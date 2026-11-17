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
import { reviewedMinBuyAmount } from "@bramble/wallet-model/avnu-route";
import { isNonZeroStarkFieldElement, sameFelt } from "@bramble/wallet-model/networks";
import type { Call } from "starknet";
import { WalletError } from "../support/errors";
import { checkedAvnuExchangeCall } from "./avnu-intent";
import {
  type AvnuRoute,
  buildApproveCall,
  fetchAvnuExchangeCall,
  fetchAvnuQuote,
  isAvnuRoute,
  parseAmount,
  slippageToFraction,
  toExchangeCall,
} from "./avnu-swap";
import { AVNU_API } from "../constants";
import { DEFAULT_SLIPPAGE_BPS } from "../support/slippage";
import type { SwapParams, SwapQuote, SwapQuoteParams } from "../types";

/**
 * AVNU protocol id for tagging quotes and routing.
 */
const AVNU_PROTOCOL_ID = "avnu" as const;

/**
 * Fetches the best aggregated swap route from the AVNU API and its slippage-bounded
 * `multi_route_swap` calldata, returning a SwapQuote whose opaque `route` carries
 * everything the synchronous buildSwapCalls needs to reproduce the trade.
 * Rejects quotes or decoded builds that disagree with the requested trade,
 * including beneficiary, minimum output, and fees, before anything is reviewed.
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
  const slippage = slippageToFraction(slippageBps);
  const sellAmount = parseAmount(params.sellAmount);
  if (sellAmount === null || sellAmount === "0") {
    throw new WalletError("Invalid AVNU sell amount");
  }
  const quote = await fetchAvnuQuote(AVNU_API.base, {
    buyToken: params.buyToken,
    sellAmount: params.sellAmount,
    sellToken: params.sellToken,
    takerAddress: params.takerAddress,
  });
  if (
    !sameFelt(quote.sellToken, params.sellToken) ||
    !sameFelt(quote.buyToken, params.buyToken) ||
    quote.sellAmount !== sellAmount
  ) {
    throw new WalletError("AVNU quote changed the requested swap");
  }
  // The build API bakes `buy_token_min_amount` (the on-chain slippage floor) into
  // the returned calldata, so slippage is bound here at quote time.
  const exchangeCall = await fetchAvnuExchangeCall(AVNU_API.base, {
    includeApprove: false,
    quoteId: quote.quoteId,
    slippage,
    takerAddress: params.takerAddress,
  });
  // AVNU rounds its floating-point build floor a few base units differently
  // from an exact integer calculation. Reuse the wallet's reviewed tolerance;
  // zero slippage still requires the full quoted output.
  const minBuyAmount =
    slippageBps === 0
      ? BigInt(quote.buyAmount)
      : reviewedMinBuyAmount(BigInt(quote.buyAmount), slippage);
  if (minBuyAmount === null) {
    throw new WalletError("Invalid AVNU minimum output");
  }
  const checked = checkedAvnuExchangeCall(
    exchangeCall,
    {
      ...quote,
      minBuyAmount: minBuyAmount.toString(),
    },
    params.takerAddress,
  );
  const route: AvnuRoute = {
    buyAmount: quote.buyAmount,
    buyToken: params.buyToken,
    exchangeCall: checked.call,
    protocol: "avnu",
    quoteId: quote.quoteId,
    sellAmount: quote.sellAmount,
    sellToken: params.sellToken,
  };
  return {
    buyAmount: quote.buyAmount,
    buyToken: params.buyToken,
    gasFeesInStrk: quote.gasFeesInStrk,
    gasFeesInUsd: quote.gasFeesInUsd,
    minBuyAmount: checked.minBuyAmount,
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
 * calldata by quoteSwap. The stored call is revalidated against the displayed
 * quote and current taker immediately before returning executable calls; any
 * mismatch throws. Because this is synchronous with no RPC access it cannot
 * read the current allowance, so it always emits an approve for exactly the sell
 * amount; the router pulls only what the swap spends, leaving no lingering
 * allowance.
 */
export const buildSwapCalls = (params: SwapParams): readonly Call[] => {
  const { route } = params.quote;
  if (params.quote.protocol !== AVNU_PROTOCOL_ID || !isAvnuRoute(route)) {
    throw new WalletError("Invalid AVNU route");
  }
  const checked = checkedAvnuExchangeCall(route.exchangeCall, params.quote, params.takerAddress);
  return [
    buildApproveCall(params.quote.sellToken, BigInt(params.quote.sellAmount)),
    toExchangeCall({ ...route, exchangeCall: checked.call }),
  ];
};
