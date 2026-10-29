/**
 * What the deploy screen shows when a sponsored deploy (issue 431) is in play. A
 * sponsored deploy charges the user nothing, so the Cost box names who pays
 * instead of showing a fee as theirs. Otherwise the user's own fee is shown,
 * exactly as the screen did before sponsorship: a refusal or an attempt that
 * ended adds nothing to it. While an attempt's hold stands the screen is
 * deploying: one status sentence, busy, and no Deploy.
 */
import {
  DEPLOYMENT_IN_PROGRESS,
  SPONSORED_DEPLOY_SPONSOR,
} from "@bramble/privacy/sponsored-deploy";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { DeploySponsorship } from "../runtime/runtime-deploy";
import { buttonBusy, renderFragment, scopedStatus } from "../shared/dom";
import { formatFeeEstimate } from "../shared/review-render";

/** The Cost line of a deploy the sponsor pays for. */
export const SPONSORED_DEPLOY_COST = `Network fee: paid by the ${SPONSORED_DEPLOY_SPONSOR}`;

/**
 * The Cost box line for `estimate` under `sponsorship`: the sponsor when it
 * pays, otherwise the user's own fee with nothing added.
 */
export const deployCostLine = (
  estimate: FeeEstimate,
  sponsorship: DeploySponsorship | undefined,
): string =>
  sponsorship === "available"
    ? SPONSORED_DEPLOY_COST
    : `Maximum network fee: ${formatFeeEstimate(estimate)}`;

/**
 * Paints the deploying state over the screen, or takes it off again: the
 * sentence on the status line, the stage busy, Deploy hidden and the Cost box
 * empty while held.
 */
export const paintDeployHold = (
  button: HTMLButtonElement,
  stage: Element | null | undefined,
  costBox: Element | null | undefined,
  held: boolean,
): void => {
  const control = button;
  control.hidden = held;
  buttonBusy(control, held);
  if (held) stage?.setAttribute("aria-busy", "true");
  else stage?.removeAttribute("aria-busy");
  if (held && costBox) renderFragment(costBox, "");
  scopedStatus(control, held ? DEPLOYMENT_IN_PROGRESS : "");
};
