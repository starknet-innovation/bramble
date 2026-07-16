/**
 * Typed runtime message client for the side panel's swap screen, kept out of
 * runtime.ts so that file stays within the size budget. Replies are validated
 * field by field before the UI trusts them — a malformed background response
 * throws instead of rendering.
 */
import { isErrorResponse } from "../popup/responses";
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import type { RuntimeApi } from "./runtime";

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
};

const isAmountText = (value: unknown): value is string =>
  typeof value === "string" && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value);

const isUsd = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isSwapQuoteView = (value: unknown): value is SwapQuoteView =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "buyAmount",
    "buyAmountInUsd",
    "gasFeesInUsd",
    "quoteId",
    "sellAmount",
    "sellAmountInUsd",
  ]) &&
  isAmountText(value["buyAmount"]) &&
  isUsd(value["buyAmountInUsd"]) &&
  isUsd(value["gasFeesInUsd"]) &&
  typeof value["quoteId"] === "string" &&
  value["quoteId"].length > 0 &&
  isAmountText(value["sellAmount"]) &&
  isUsd(value["sellAmountInUsd"]);

const responseError = (response: unknown, fallback: string): Error =>
  new Error(isErrorResponse(response) ? response.error : fallback);

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
    async execute(input: {
      readonly amount: string;
      readonly buyAmount: string;
      readonly buyTokenId: string;
      readonly quoteId: string;
      readonly sellTokenId: string;
    }): Promise<string> {
      const response = await sendMessage({ ...input, type: "wallet.swapExecute" });
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
