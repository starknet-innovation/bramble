/**
 * Typed runtime message client for the side panel's swap screen, kept out of
 * runtime.ts so that file stays within the size budget. Replies are validated
 * field by field before the UI trusts them — a malformed background response
 * throws instead of rendering.
 */

import { isSha256Digest } from "@bramble/core/ids";
import {
  hasOnlyKnownKeys,
  isDecimalAmountText,
  isRecord,
  isRiskFlagCode,
} from "@bramble/core/json";
import { type FeeEstimate, isFeeEstimate } from "@bramble/starknet/fee-bounds";
import type { RuntimeApi } from "../../runtime/runtime";
import { responseError } from "../../runtime/runtime-errors";

/**
 * Display-ready quote consumed by the swap screen: decimal amounts plus the
 * USD figures for the meta line and the confirmation receipt.
 */
export type SwapQuoteView = {
  readonly buyAmount: string;
  readonly buyAmountInUsd: number;
  readonly gasFeesInUsd: number;
  readonly quoteId: string;
  readonly sellAmount: string;
  readonly sellAmountInUsd: number;
  // Value delta the background priced from the wallet's own feed (Sherlock
  // 137). Preferred over the aggregator's figures, which describe its own
  // quote; absent when the feed has no price for either token.
  readonly valueDeltaPercent?: number;
};

/**
 * Exact decoded calls and warnings frozen by the background before the user
 * reaches the final confirmation step.
 */
export type SwapPreparationView = {
  readonly flags: readonly { readonly code: string; readonly message: string }[];
  readonly id: string;
  // Minimum output the frozen route carries, decoded from its calldata by the
  // background build policy. The confirm card shows THIS rather than a figure
  // derived beside the transaction, so the minimum it states is the minimum the
  // signed call enforces.
  readonly minBuyAmount: string;
  readonly payloadDigest: string;
  readonly reviewedFee: FeeEstimate;
  readonly summaries: readonly string[];
};

const isUsd = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

// A loss can be at most the whole sell side; a gain is unbounded but finite.
const isValueDelta = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= -100;

const isSwapQuoteView = (value: unknown): value is SwapQuoteView =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "buyAmount",
    "buyAmountInUsd",
    "gasFeesInUsd",
    "quoteId",
    "sellAmount",
    "sellAmountInUsd",
    "valueDeltaPercent",
  ]) &&
  isDecimalAmountText(value["buyAmount"]) &&
  isUsd(value["buyAmountInUsd"]) &&
  isUsd(value["gasFeesInUsd"]) &&
  typeof value["quoteId"] === "string" &&
  value["quoteId"].length > 0 &&
  isDecimalAmountText(value["sellAmount"]) &&
  isUsd(value["sellAmountInUsd"]) &&
  (value["valueDeltaPercent"] === undefined || isValueDelta(value["valueDeltaPercent"]));

const isSwapPreparationView = (value: unknown): value is SwapPreparationView =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "flags",
    "id",
    "minBuyAmount",
    "payloadDigest",
    "reviewedFee",
    "summaries",
  ]) &&
  isSha256Digest(value["id"]) &&
  value["payloadDigest"] === value["id"] &&
  isDecimalAmountText(value["minBuyAmount"]) &&
  isFeeEstimate(value["reviewedFee"]) &&
  Array.isArray(value["summaries"]) &&
  value["summaries"].length > 0 &&
  value["summaries"].length <= 4 &&
  value["summaries"].every(
    (summary) => typeof summary === "string" && summary.length > 0 && summary.length <= 300,
  ) &&
  Array.isArray(value["flags"]) &&
  value["flags"].length <= 12 &&
  value["flags"].every(
    (flag) =>
      isRecord(flag) &&
      hasOnlyKnownKeys(flag, ["code", "message"]) &&
      isRiskFlagCode(flag["code"]) &&
      typeof flag["message"] === "string" &&
      flag["message"].length > 0 &&
      flag["message"].length <= 300,
  );

/**
 * Value delta of a quote in percent: how much MORE (+) or LESS (−) the buy
 * side is worth than the sell side. This is the swap screen's sanity heuristic
 * — a dust-sized order routed through a thin or mispriced pool shows up here
 * as a large negative delta before the user can act on it.
 *
 * Two figures are available: the delta the background priced from the wallet's
 * own feed, and one from the aggregator's USD figures. The worse of the two
 * wins: the feed keeps an aggregator from hiding a loss behind its own
 * figures, and the aggregator's figures keep a stale or mismatched feed price
 * from hiding a loss it reports (Sherlock 137). In the aggregator's figures a
 * priced sell side whose buy side is valued at zero is a total loss rather
 * than "unpriced", since a zero there would otherwise switch the warning off.
 * Null when neither figure is available.
 */
export const swapValueDeltaPercent = (quote: SwapQuoteView): number | null => {
  const aggregatorDelta =
    quote.sellAmountInUsd > 0
      ? ((quote.buyAmountInUsd - quote.sellAmountInUsd) / quote.sellAmountInUsd) * 100
      : null;
  if (quote.valueDeltaPercent === undefined) {
    return aggregatorDelta;
  }
  return aggregatorDelta === null
    ? quote.valueDeltaPercent
    : Math.min(quote.valueDeltaPercent, aggregatorDelta);
};

/**
 * Loss thresholds (percent) for the quote sanity tiers: WARN surfaces an
 * explicit explanation under the quote; HIGH_RISK additionally restyles the
 * submit action as a danger control labelled "Swap anyway".
 */
export const SWAP_LOSS_WARN_PERCENT = 5;
/**
 * Loss threshold (percent) above which the submit action turns into an
 * explicit danger-styled "Swap anyway".
 */
export const SWAP_LOSS_HIGH_RISK_PERCENT = 15;

/**
 * One verified catalog entry shown by the token picker. Directory data only:
 * selecting an untracked entry goes through the wallet's add-token flow,
 * which re-reads the token's facts from the contract on-chain.
 */
export type SwapCatalogTokenView = {
  readonly address: string;
  readonly decimals: number;
  readonly name: string;
  readonly symbol: string;
};

const isCatalogToken = (value: unknown): value is SwapCatalogTokenView =>
  isRecord(value) &&
  typeof value["address"] === "string" &&
  /^0x[0-9a-f]{1,64}$/.test(value["address"]) &&
  typeof value["decimals"] === "number" &&
  Number.isInteger(value["decimals"]) &&
  typeof value["name"] === "string" &&
  value["name"].length > 0 &&
  typeof value["symbol"] === "string" &&
  value["symbol"].length > 0;

/**
 * Swap client surface returned by createSwapClient.
 */
export type SwapClient = ReturnType<typeof createSwapClient>;

/**
 * Creates side panel swap actions over chrome.runtime messaging.
 */
export const createSwapClient = (runtime?: RuntimeApi) => {
  const sendMessage = async (message: unknown): Promise<unknown> => runtime?.sendMessage(message);

  return {
    async execute(preparationId: string): Promise<string> {
      const response = await sendMessage({
        preparationId,
        type: "wallet.swapExecute",
      });
      if (
        isRecord(response) &&
        response["ok"] === true &&
        typeof response["transactionHash"] === "string" &&
        response["transactionHash"].length > 0
      ) {
        return response["transactionHash"];
      }
      throw responseError(response, "swap failed");
    },
    async prepare(input: {
      readonly amount: string;
      readonly buyAmount: string;
      readonly buyTokenId: string;
      readonly quoteId: string;
      readonly sellTokenId: string;
    }): Promise<SwapPreparationView> {
      const response = await sendMessage({ ...input, type: "wallet.swapPrepare" });
      if (
        isRecord(response) &&
        response["ok"] === true &&
        isSwapPreparationView(response["swapPreparation"])
      ) {
        return response["swapPreparation"];
      }
      throw responseError(response, "swap preparation failed");
    },
    async tokens(): Promise<readonly SwapCatalogTokenView[]> {
      const response = await sendMessage({ type: "wallet.swapTokens" });
      if (
        isRecord(response) &&
        response["ok"] === true &&
        Array.isArray(response["swapTokens"]) &&
        response["swapTokens"].every(isCatalogToken)
      ) {
        return response["swapTokens"];
      }
      throw responseError(response, "token list unavailable");
    },
    async quote(input: {
      readonly amount: string;
      readonly buyTokenId: string;
      readonly sellTokenId: string;
    }): Promise<SwapQuoteView> {
      const response = await sendMessage({ ...input, type: "wallet.swapQuote" });
      if (isRecord(response) && response["ok"] === true && isSwapQuoteView(response["swapQuote"])) {
        return response["swapQuote"];
      }
      throw responseError(response, "swap quote failed");
    },
  };
};
