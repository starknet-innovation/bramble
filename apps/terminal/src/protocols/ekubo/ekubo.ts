/**
 * Ekubo integration — concentrated-liquidity AMM, fully on-chain. `quoteSwap`
 * reads an on-chain quote from the RouterV3 `quote_swap` entrypoint (trying each
 * standard fee tier and keeping the best-priced pool), and `buildSwapCalls`
 * assembles the documented 4-call multicall (transfer input -> Router `swap`
 * with a slippage-bounded sqrt_ratio_limit -> `clear_minimum` min-output check
 * -> `clear` residuals) for the in-wallet invoke path. No external SDK —
 * calldata is built with the vendored starknet-js.
 *
 * ⚠️ SwapQuoteParams carries no `rpcUrls`, so quoting reads against the default
 * mainnet endpoint (Ekubo is mainnet-only and every constant here is mainnet);
 * thread a configured RPC list through once the shared contract exposes one.
 */
import type { Call } from "starknet";
import { WalletError } from "../support/errors";
import { DEFAULT_NETWORK, isNonZeroStarkFieldElement } from "../support/networks";
import { isTransportRpcError, withRpcFallback } from "../support/provider";
import { EKUBO_ADDRESSES } from "../constants";
import {
  applySlippageFloor,
  buildClearCall,
  buildClearMinimumCall,
  buildPoolKey,
  buildPoolPriceCalldata,
  buildQuoteCalldata,
  buildRouterSwapCall,
  buildRouterTransferCall,
  computeSqrtRatioLimit,
  EKUBO_FEE_TIERS,
  EKUBO_SKIP_AHEAD,
  type EkuboPoolKey,
  type EkuboRoute,
  isEkuboRoute,
  orderTokens,
  parsePoolSqrtRatio,
  parseQuoteOutput,
} from "./ekubo-swap";
import { DEFAULT_SLIPPAGE_BPS } from "../support/slippage";
import type { SwapParams, SwapQuote, SwapQuoteParams } from "../types";

/**
 * Ekubo protocol id for tagging quotes and routing.
 */
const EKUBO_PROTOCOL_ID = "ekubo" as const;

// Parses a raw smallest-unit integer amount string, rejecting floats and zero.
const parseRawAmount = (amount: string): bigint => {
  const trimmed = amount.trim();
  if (!/^(?:0|[1-9][0-9]*)$/.test(trimmed)) {
    throw new WalletError("Invalid Ekubo sell amount");
  }
  const raw = BigInt(trimmed);
  if (raw <= 0n) {
    throw new WalletError("Ekubo sell amount must be greater than zero");
  }
  return raw;
};

// The best-priced pool found while scanning the standard fee tiers.
type BestPool = {
  readonly poolKey: EkuboPoolKey;
  readonly buyAmount: bigint;
};

/**
 * Fetches an on-chain swap quote from the Ekubo RouterV3. Scans the standard fee
 * tiers via `quote_swap`, keeps the pool with the largest output, then reads that
 * pool's current sqrt ratio from Core so buildSwapCalls can bound slippage. The
 * returned `route` is an EkuboRoute the matching buildSwapCalls consumes.
 */
export const quoteSwap = async (params: SwapQuoteParams): Promise<SwapQuote> => {
  const { buyToken, sellAmount, sellToken } = params;
  if (!isNonZeroStarkFieldElement(sellToken) || !isNonZeroStarkFieldElement(buyToken)) {
    throw new WalletError("Invalid Ekubo swap token");
  }
  if (BigInt(sellToken) === BigInt(buyToken)) {
    throw new WalletError("Ekubo swap tokens must differ");
  }
  const sellAmountRaw = parseRawAmount(sellAmount);
  const { sellIsToken0, token0, token1 } = orderTokens(sellToken, buyToken);
  const slippageBps = params.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

  return withRpcFallback([...DEFAULT_NETWORK.rpcUrls], async (provider) => {
    let best: BestPool | null = null;
    for (const tier of EKUBO_FEE_TIERS) {
      const poolKey = buildPoolKey(token0, token1, tier);
      try {
        const response = await provider.callContract(
          {
            calldata: buildQuoteCalldata(poolKey, sellToken, sellAmountRaw, sellIsToken0),
            contractAddress: EKUBO_ADDRESSES.routerV3,
            entrypoint: "quote_swap",
          },
          "latest",
        );
        const buyAmount = parseQuoteOutput(response, sellIsToken0);
        if (buyAmount > 0n && (best === null || buyAmount > best.buyAmount)) {
          best = { buyAmount, poolKey };
        }
      } catch (error) {
        // A missing pool for a tier surfaces as a contract-level error; only
        // transport failures should abort the scan and fail over.
        if (isTransportRpcError(error)) {
          throw error;
        }
      }
    }
    if (best === null) {
      throw new WalletError("No Ekubo pool for this pair");
    }

    const priceResponse = await provider.callContract(
      {
        calldata: buildPoolPriceCalldata(best.poolKey),
        contractAddress: EKUBO_ADDRESSES.core,
        entrypoint: "get_pool_price",
      },
      "latest",
    );
    const currentSqrtRatio = parsePoolSqrtRatio(priceResponse);

    const route: EkuboRoute = {
      buyAmount: best.buyAmount.toString(),
      buyToken,
      currentSqrtRatio: currentSqrtRatio.toString(),
      poolKey: best.poolKey,
      protocol: "ekubo",
      sellAmount: sellAmountRaw.toString(),
      sellIsToken0,
      sellToken,
      skipAhead: EKUBO_SKIP_AHEAD,
    };
    return {
      buyAmount: best.buyAmount.toString(),
      buyToken,
      minBuyAmount: applySlippageFloor(best.buyAmount, slippageBps).toString(),
      protocol: EKUBO_PROTOCOL_ID,
      route,
      sellAmount: sellAmountRaw.toString(),
      sellToken,
    };
  });
};

/**
 * Builds the Ekubo swap multicall for a quoted trade: transfer the input token
 * to the router, swap through the quoted pool with a slippage-bounded
 * sqrt_ratio_limit, enforce the min output via `clear_minimum`, and `clear` any
 * residual input. Returns starknet-js Calls ready for submitInvokeTransaction.
 */
export const buildSwapCalls = (params: SwapParams): readonly Call[] => {
  const route = params.quote.route;
  if (!isEkuboRoute(route)) {
    throw new WalletError("Ekubo buildSwapCalls needs an Ekubo route");
  }
  if (!isNonZeroStarkFieldElement(params.takerAddress)) {
    throw new WalletError("Invalid Ekubo taker address");
  }
  const slippageBps = params.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const sellAmountRaw = BigInt(route.sellAmount);
  const minBuyAmount = applySlippageFloor(BigInt(route.buyAmount), slippageBps);
  const sqrtRatioLimit = computeSqrtRatioLimit(
    BigInt(route.currentSqrtRatio),
    slippageBps,
    route.sellIsToken0,
  );
  return [
    buildRouterTransferCall(route.sellToken, sellAmountRaw),
    buildRouterSwapCall(
      route.poolKey,
      route.sellToken,
      sellAmountRaw,
      sqrtRatioLimit,
      route.skipAhead,
    ),
    buildClearMinimumCall(route.buyToken, minBuyAmount),
    buildClearCall(route.sellToken),
  ];
};
