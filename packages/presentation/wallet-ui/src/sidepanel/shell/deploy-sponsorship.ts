/**
 * What the deploy screen's Cost box says when a sponsored deploy (issue 431) is in
 * play. A sponsored deploy charges the user nothing, so the box names who pays
 * instead of showing a fee as theirs; when the sponsor declines, the user's own
 * fee comes back with the reason, so a self-paid press is still a reviewed one.
 */
import { SPONSORED_DEPLOY_SPONSOR } from "@bramble/privacy/sponsored-deploy";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { DeploySponsorship } from "../runtime/runtime-deploy";
import { formatFeeEstimate } from "../shared/review-render";

/** The Cost line of a deploy the sponsor pays for. */
export const SPONSORED_DEPLOY_COST = `Network fee: paid by the ${SPONSORED_DEPLOY_SPONSOR}`;

// Added to the user's own fee once the sponsor has declined.
const SPONSOR_DECLINED_NOTE = `The ${SPONSORED_DEPLOY_SPONSOR} couldn't cover this deployment.`;

/**
 * The Cost box line for `estimate` under `sponsorship`; an unanswered or
 * absent offer shows the user's own fee, as the screen did before sponsorship.
 */
export const deployCostLine = (
  estimate: FeeEstimate,
  sponsorship: DeploySponsorship | undefined,
): string => {
  if (sponsorship === "available") return SPONSORED_DEPLOY_COST;
  const fee = `Maximum network fee: ${formatFeeEstimate(estimate)}`;
  return sponsorship === "refused" ? `${fee}. ${SPONSOR_DECLINED_NOTE}` : fee;
};
