/**
 * Side-panel client for account deployment: the self-paid deploy (quote, then
 * submit under the quoted fee) and the sponsored deploy (issue 431), where the
 * Starknet Foundation pays the fee. Split from the main runtime by the
 * file-size budget.
 */

import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { DeploySponsorship } from "@bramble/privacy/sponsored-deploy";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import { isFeeReviewResponse, isTransferResponse } from "../../popup/responses/responses";
import { responseError } from "./runtime-errors";

/** The background's deploy-screen offer, single-sourced with the background. */
export type { DeploySponsorship };

const SPONSORSHIPS: readonly unknown[] = ["available", "held", "none"];

const isSponsorship = (value: unknown): value is DeploySponsorship => SPONSORSHIPS.includes(value);

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
   * transaction hash, or null when the sponsor is not deploying it and nothing
   * was sent (the screen then deploys self-paid, silently). A lost reply
   * rejects as outcome-unknown, never as failed.
   */
  async deployAccountSponsored(): Promise<string | null> {
    const response = await sendMessage({ type: "wallet.deployAccountSponsored" });
    if (isTransferResponse(response)) return response.transactionHash;
    if (
      isRecord(response) &&
      hasOnlyKnownKeys(response, ["ok", "sponsored"]) &&
      response["ok"] === true &&
      response["sponsored"] === false
    ) {
      return null;
    }
    throw responseError(response, "deployment failed");
  },
});
