/**
 * Side-panel client for the phrase-driven account-recovery flows (Braavos 2FA
 * removal, Ready guardian escape). Split from the main runtime by the file-size
 * budget. A review quotes what the confirmation states; a submit sends back
 * exactly what was confirmed — the reviewed account, the maximum fee, the step,
 * and (Ready) whether the user acknowledged cancelling a pending owner escape —
 * so the background can refuse anything that moved in between.
 */
import {
  isRecoverAccountResponse,
  isRecoveryReview,
  type RecoverAccountResponse,
  type RecoveryReview,
} from "../../popup/responses/responses-recovery";
import { responseError } from "./runtime-errors";

/**
 * Creates the recovery client over chrome.runtime messaging. Each method
 * rejects on a malformed reply rather than returning a half-formed result; a
 * submission whose outcome is unknown rejects with `SubmissionUnknownError`.
 */
export const createRecoveryRuntimeClient = (
  sendMessage: (message: unknown) => Promise<unknown>,
) => ({
  /** Quotes the Braavos 2FA-removal request for its confirmation. */
  async reviewBraavosRecovery(): Promise<RecoveryReview> {
    const response = await sendMessage({ type: "wallet.reviewBraavosRecovery" });
    if (isRecoveryReview(response)) return response;
    throw responseError(response, "account recovery unavailable");
  },
  /** Submits the confirmed Braavos 2FA-removal request. */
  async recoverBraavosAccount(review: RecoveryReview): Promise<RecoverAccountResponse> {
    const response = await sendMessage({
      accountId: review.accountId,
      reviewedFee: review.fee,
      type: "wallet.recoverBraavosAccount",
    });
    if (isRecoverAccountResponse(response)) return response;
    throw responseError(response, "account recovery failed");
  },
  /** Quotes the Ready recovery's next escape step for its confirmation. */
  async reviewArgentRecovery(): Promise<RecoveryReview> {
    const response = await sendMessage({ type: "wallet.reviewArgentRecovery" });
    if (isRecoveryReview(response)) return response;
    throw responseError(response, "account recovery unavailable");
  },
  /**
   * Submits the confirmed Ready escape step. `replaceEscapeReadyAt` names the
   * exact pending escape the confirmation warned about, and is sent only then.
   */
  async recoverArgentAccount(review: RecoveryReview): Promise<RecoverAccountResponse> {
    const response = await sendMessage({
      accountId: review.accountId,
      ...(review.step === "start" && review.replaces !== null
        ? { replaceEscapeReadyAt: review.replaces.readyAt }
        : {}),
      reviewedFee: review.fee,
      step: review.step,
      type: "wallet.recoverArgentAccount",
    });
    if (isRecoverAccountResponse(response)) return response;
    throw responseError(response, "account recovery failed");
  },
});
