/**
 * Readers for the side panel's approval decisions. Split from
 * ./message-inputs, which had reached the file-size gate, and because these
 * two echoes are a boundary of their own: they are what binds an approval to
 * the card the user actually read.
 */

import { isUuid } from "@bramble/core/ids";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { type FeeEstimate, isFeeEstimate } from "@bramble/starknet/fee-bounds";
import { type GaslessFeeOffer, isGaslessFeeOffer } from "@bramble/transactions/gasless-request";
import { isAccountId } from "@bramble/wallet-model/accounts";

/**
 * Parses popup approval decisions by pending approval id, plus what the
 * deciding surface was displaying when the user clicked: the optional fee, and
 * for a connection the account the card named as the one being shared.
 *
 * The echo is what binds a fee-bearing approval to the figure that was actually
 * on screen: the queue's own copy can be replaced by a re-estimate from another
 * open surface between the paint and the click, so an approval that submitted
 * under whatever the queue held at claim time would enforce a ceiling nobody
 * read. Untrusted input like any other field — a malformed echo refuses the
 * whole message rather than being dropped, because a silently dropped ceiling is
 * an unbound submission wearing the appearance of a bound one. The account echo
 * works the same way for connections: the grant is applied only if the wallet's
 * active account is still the one the card showed (spec item 15).
 */
export const readApprovalIdInput = (
  message: unknown,
): {
  readonly gaslessFee?: GaslessFeeOffer;
  readonly id: string;
  readonly reviewedAccountId?: string;
  readonly reviewedFee?: FeeEstimate;
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["gaslessFee", "id", "reviewedAccountId", "reviewedFee", "type"]) ||
    (message["type"] !== "wallet.approveOrigin" && message["type"] !== "wallet.denyOrigin") ||
    typeof message["id"] !== "string" ||
    !isUuid(message["id"]) ||
    (message["gaslessFee"] !== undefined && !isGaslessFeeOffer(message["gaslessFee"])) ||
    (message["reviewedFee"] !== undefined && !isFeeEstimate(message["reviewedFee"])) ||
    (message["reviewedAccountId"] !== undefined && !isAccountId(message["reviewedAccountId"]))
  ) {
    return null;
  }
  return {
    id: message["id"],
    ...(isAccountId(message["reviewedAccountId"])
      ? { reviewedAccountId: message["reviewedAccountId"] }
      : {}),
    ...(isGaslessFeeOffer(message["gaslessFee"]) ? { gaslessFee: message["gaslessFee"] } : {}),
    ...(isFeeEstimate(message["reviewedFee"]) ? { reviewedFee: message["reviewedFee"] } : {}),
  };
};
