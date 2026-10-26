/**
 * Side-panel client for account deployment: the self-paid deploy (quote, then
 * submit under the quoted fee) and the sponsored deploy (issue 431), where the
 * Starknet Foundation pays the fee. Split from the main runtime by the
 * file-size budget.
 */

import { isRecord } from "@bramble/core/json";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import { isFeeReviewResponse, isTransferResponse } from "../../popup/responses/responses";
import { responseError } from "./runtime-errors";

/** What the deploy screen may offer, as the background decided it. */
export type DeploySponsorship = "available" | "none" | "refused";

const isSponsorship = (value: unknown): value is DeploySponsorship =>
  value === "available" || value === "none" || value === "refused";

/** Creates the deployment client over chrome.runtime messaging. */
export const createDeployRuntimeClient = (sendMessage: (message: unknown) => Promise<unknown>) => ({
  /**
   * Without `reviewedFee`, returns the fee to show; with it, submits under
   * that ceiling and returns the transaction hash.
   */
  async deployAccount(reviewedFee?: FeeEstimate): Promise<FeeEstimate | string> {
    const response = await sendMessage({
      ...(reviewedFee ? { reviewedFee } : {}),
      type: "wallet.deployAccount",
    });
    if (isFeeReviewResponse(response)) return response.feeReview;
    if (isTransferResponse(response)) {
      return response.transactionHash;
    }
    throw responseError(response, "deployment failed");
  },
  /**
   * Whether the background offers a sponsored deploy. Advisory only, and never
   * throws: a refusal, a lost reply or a malformed answer reads as "none", so
   * the screen keeps its self-paid fee.
   */
  async deploySponsorship(): Promise<DeploySponsorship> {
    const response = await sendMessage({ type: "wallet.deploySponsorship" }).catch(() => null);
    return isRecord(response) && response["ok"] === true && isSponsorship(response["sponsorship"])
      ? response["sponsorship"]
      : "none";
  },
  /**
   * Deploys the active account with the sponsor paying the fee; returns the
   * transaction hash. A lost reply rejects as outcome-unknown, never as failed.
   */
  async deployAccountSponsored(): Promise<string> {
    const response = await sendMessage({ type: "wallet.deployAccountSponsored" });
    if (isTransferResponse(response)) return response.transactionHash;
    throw responseError(response, "deployment failed");
  },
});
