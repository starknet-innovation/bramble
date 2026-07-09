/**
 * AVNU integration stub — DEX aggregator routing across many AMMs. Phase-2
 * fills these in: `quoteSwap` calls the AVNU quotes API (AVNU_API.base) for the
 * best multi-venue route, and `buildSwapCalls` assembles the approve ->
 * `multi_route_swap` multicall (spender = AVNU_ADDRESSES.exchange) for the
 * in-wallet invoke path. Do NOT import @avnu/avnu-sdk — build calldata directly
 * with the vendored starknet-js from the quote's documented shape.
 */
import type { Call } from "starknet";
import { WalletError } from "../../shared/errors";
import type { SwapParams, SwapQuote, SwapQuoteParams } from "./types";

/**
 * AVNU protocol id for tagging quotes and routing.
 */
export const AVNU_PROTOCOL_ID = "avnu" as const;

/**
 * Fetches the best aggregated swap route from the AVNU API. TODO(phase2).
 */
export const quoteSwap = (_params: SwapQuoteParams): Promise<SwapQuote> => {
  // TODO(phase2): GET AVNU quotes { sellTokenAddress, buyTokenAddress,
  // sellAmount, takerAddress, size: 1 }, take quotes[0].routes[0], and map into
  // a SwapQuote carrying the exchange spender + route for buildSwapCalls.
  throw new WalletError("avnu quoteSwap not implemented");
};

/**
 * Builds the AVNU approve + multi_route_swap multicall. TODO(phase2).
 */
export const buildSwapCalls = (_params: SwapParams): readonly Call[] => {
  // TODO(phase2): emit [erc20 approve(exchange, sellAmount) when allowance is
  // short, then exchange.multi_route_swap(...)] from the quoted route with a
  // 0.1% default slippage bound.
  throw new WalletError("avnu buildSwapCalls not implemented");
};
