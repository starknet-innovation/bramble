/**
 * Side-panel client for the phrase-driven account-recovery flows (Braavos 2FA
 * removal, Ready guardian escape). Split from the main runtime by the file-size
 * budget; the review methods quote the next step's fee and delay, the submit
 * methods advance it. Both vendors share one response shape, so one validator
 * guards each direction.
 */
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import {
  isRecoverBraavosAccountResponse,
  isReviewBraavosRecoveryResponse,
  type RecoverBraavosAccountResponse,
  type ReviewBraavosRecoveryResponse,
} from "../../popup/responses/responses-transfer";
import { responseError } from "./runtime-errors";

/**
 * Creates the recovery client over chrome.runtime messaging. Each method
 * rejects on a malformed reply rather than returning a half-formed result.
 */
export const createRecoveryRuntimeClient = (
  sendMessage: (message: unknown) => Promise<unknown>,
) => ({
  /** Quotes the Braavos 2FA-removal request (fee + delay) for its review card. */
  async reviewBraavosRecovery(): Promise<ReviewBraavosRecoveryResponse> {
    const response = await sendMessage({ type: "wallet.reviewBraavosRecovery" });
    if (isReviewBraavosRecoveryResponse(response)) return response;
    throw responseError(response, "account recovery unavailable");
  },
  /** Submits the reviewed Braavos 2FA-removal request. */
  async recoverBraavosAccount(reviewedFee: FeeEstimate): Promise<RecoverBraavosAccountResponse> {
    const response = await sendMessage({ reviewedFee, type: "wallet.recoverBraavosAccount" });
    if (isRecoverBraavosAccountResponse(response)) return response;
    throw responseError(response, "account recovery failed");
  },
  /** Quotes the Ready recovery's next escape step (fee + delay). */
  async reviewArgentRecovery(): Promise<ReviewBraavosRecoveryResponse> {
    const response = await sendMessage({ type: "wallet.reviewArgentRecovery" });
    if (isReviewBraavosRecoveryResponse(response)) return response;
    throw responseError(response, "account recovery unavailable");
  },
  /** Submits the reviewed Ready recovery step (trigger, or complete once ready). */
  async recoverArgentAccount(reviewedFee: FeeEstimate): Promise<RecoverBraavosAccountResponse> {
    const response = await sendMessage({ reviewedFee, type: "wallet.recoverArgentAccount" });
    if (isRecoverBraavosAccountResponse(response)) return response;
    throw responseError(response, "account recovery failed");
  },
});
