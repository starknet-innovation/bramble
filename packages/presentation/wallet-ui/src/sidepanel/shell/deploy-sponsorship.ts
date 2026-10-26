/**
 * What the deploy screen's Cost box says when a sponsored deploy (issue 431) is in
 * play. A sponsored deploy charges the user nothing, so the box names who pays
 * instead of showing a fee as theirs. Otherwise the user's own fee is shown,
 * with one line when the sponsor declined or an earlier sponsored attempt may
 * still land, so a self-paid press is always a reviewed one.
 */
import { SPONSORED_DEPLOY_SPONSOR } from "@bramble/privacy/sponsored-deploy";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { DeploySponsorship } from "../runtime/runtime-deploy";
import { formatFeeEstimate } from "../shared/review-render";

/** The Cost line of a deploy the sponsor pays for. */
export const SPONSORED_DEPLOY_COST = `Network fee: paid by the ${SPONSORED_DEPLOY_SPONSOR}`;

// Added to the user's own fee: the sponsor declined, an earlier sponsored
// attempt's hold still stands, or it is over and the deploy may still land.
const COST_NOTES: Readonly<Record<"held" | "may-land" | "refused", string>> = {
  held: "A sponsored deployment of this account may already be on its way.",
  "may-land": "A sponsored deployment may still land. If it does, yours is refused at no cost.",
  refused: `The ${SPONSORED_DEPLOY_SPONSOR} couldn't cover this deployment.`,
};

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
  return sponsorship === undefined || sponsorship === "none"
    ? fee
    : `${fee}. ${COST_NOTES[sponsorship]}`;
};
