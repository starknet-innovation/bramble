/**
 * Ekubo integration stub — concentrated-liquidity AMM, fully on-chain. Phase-2
 * fills these in: `quoteSwap` reads an on-chain quote from the RouterV3
 * `quote_swap` entrypoint (see EKUBO_ADDRESSES.routerV3), and `buildSwapCalls`
 * assembles the documented 4-call multicall (transfer input -> Router `swap`
 * with a slippage-bounded sqrt_ratio_limit -> min-output check -> clear
 * residuals) for the in-wallet invoke path. No external SDK — build calldata
 * with the vendored starknet-js.
 */
import type { Call } from "starknet";
import { WalletError } from "../../shared/errors";
import type { SwapParams, SwapQuote, SwapQuoteParams } from "./types";

/**
 * Ekubo protocol id for tagging quotes and routing.
 */
export const EKUBO_PROTOCOL_ID = "ekubo" as const;

/**
 * Fetches an on-chain swap quote from the Ekubo RouterV3. TODO(phase2).
 */
export const quoteSwap = (_params: SwapQuoteParams): Promise<SwapQuote> => {
  // TODO(phase2): call RouterV3.quote_swap(routeNode, tokenAmount) via
  // withRpcFallback and map the signed {amount0, amount1} magnitudes into a
  // SwapQuote (buyAmount + slippage-derived minBuyAmount).
  throw new WalletError("ekubo quoteSwap not implemented");
};

/**
 * Builds the Ekubo swap multicall for a quoted trade. TODO(phase2).
 */
export const buildSwapCalls = (_params: SwapParams): readonly Call[] => {
  // TODO(phase2): emit [erc20 transfer -> Router swap(pool_key, sqrt_ratio_limit)
  // -> min-output verification -> clear] using CallData.compile + cairo.uint256.
  throw new WalletError("ekubo buildSwapCalls not implemented");
};
