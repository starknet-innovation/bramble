/**
 * Parsers for extension-page ERC-20 transfer messages. Untrusted text is
 * checked here and rejected as null; the handlers never see a field this
 * module did not accept. A gasless fee is optional: absent means pay in STRK.
 */

import { hasOnlyKnownKeys, isDecimalAmountText, isRecord } from "@bramble/core/json";
import { type GaslessFeeOffer, isGaslessFeeOffer } from "@bramble/privacy/gasless-request";
import { type FeeEstimate, isFeeEstimate } from "@bramble/starknet/fee-bounds";
import { isAccountId } from "@bramble/wallet-model/accounts";
import { isStarkFieldElement } from "@bramble/wallet-model/networks";

/**
 * Checks a human-entered decimal token amount string (shared by the transfer
 * and swap input readers; parsing/scaling happens later via parseTokenAmount).
 */
export const isTransferAmount = (value: unknown): value is string =>
  typeof value === "string" && isDecimalAmountText(value.trim());

const readTransferFields = (
  message: unknown,
  type: "wallet.reviewTransfer" | "wallet.transfer",
): {
  readonly accountId: string;
  readonly amount: string;
  readonly recipient: string;
  /** The token the user chose for the network fee. Absent means pay in STRK. */
  readonly gaslessFee?: GaslessFeeOffer;
  /**
   * The fee the review step displayed, echoed back by the panel on send. The
   * background turns it into a signing ceiling (MCW-V09-119); absent means the
   * caller reviewed no fee and the send is bounded only by the node's quote.
   */
  readonly reviewedDeploymentFee?: FeeEstimate;
  readonly reviewedFee?: FeeEstimate;
  readonly speed: "fast" | "standard";
  readonly tokenId: string;
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, [
      "accountId",
      "amount",
      "gaslessFee",
      "recipient",
      "reviewedDeploymentFee",
      "reviewedFee",
      "speed",
      "tokenId",
      "type",
    ]) ||
    message["type"] !== type ||
    !isAccountId(message["accountId"]) ||
    !isTransferAmount(message["amount"]) ||
    typeof message["recipient"] !== "string" ||
    !isStarkFieldElement(message["recipient"]) ||
    typeof message["tokenId"] !== "string" ||
    message["tokenId"].length === 0 ||
    (message["reviewedDeploymentFee"] !== undefined &&
      !isFeeEstimate(message["reviewedDeploymentFee"])) ||
    (message["gaslessFee"] !== undefined && !isGaslessFeeOffer(message["gaslessFee"])) ||
    (message["reviewedFee"] !== undefined && !isFeeEstimate(message["reviewedFee"])) ||
    (message["speed"] !== undefined &&
      message["speed"] !== "fast" &&
      message["speed"] !== "standard")
  ) {
    return null;
  }

  return {
    accountId: message["accountId"],
    amount: message["amount"].trim(),
    recipient: message["recipient"],
    ...(isGaslessFeeOffer(message["gaslessFee"]) ? { gaslessFee: message["gaslessFee"] } : {}),
    ...(isFeeEstimate(message["reviewedDeploymentFee"])
      ? { reviewedDeploymentFee: message["reviewedDeploymentFee"] }
      : {}),
    ...(isFeeEstimate(message["reviewedFee"]) ? { reviewedFee: message["reviewedFee"] } : {}),
    speed: message["speed"] === "fast" ? "fast" : "standard",
    tokenId: message["tokenId"],
  };
};

/**
 * Parses side panel transfer requests before touching wallet state.
 */
export const readTransferInput = (message: unknown): ReturnType<typeof readTransferFields> =>
  readTransferFields(message, "wallet.transfer");

/**
 * Parses pre-sign transfer review requests from extension pages.
 */
export const readReviewTransferInput = (message: unknown): ReturnType<typeof readTransferFields> =>
  readTransferFields(message, "wallet.reviewTransfer");
