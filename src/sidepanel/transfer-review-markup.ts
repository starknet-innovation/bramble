/**
 * Shared decoded-transfer review markup used by Send and NFT transfer flows.
 */
import { escapeHtml } from "../shared/html";
import { button } from "../ui/controls";
import { formatFri } from "./parts";
import { reviewCallsList, reviewPanel, riskFlagMessages } from "./review-render";
import type { SidepanelWallet } from "./runtime";

type TransferReview = Awaited<ReturnType<SidepanelWallet["reviewTransfer"]>>;

const feeLineHtml = (review: TransferReview): string => {
  if (review.fee) {
    return `<p class="review-fee">Estimated fee: ${escapeHtml(formatFri(review.fee.overallFee))}</p>`;
  }
  if (review.requiresDeployment) {
    return '<p class="review-fee">The network fee is estimated once this account is deployed.</p>';
  }
  if (review.feeEstimateFailed) {
    return `<p class="review-flag" role="alert">Couldn't estimate the network fee right now. Check your connection and retry before sending.</p>${button(
      {
        attributes: { id: "review-retry-fee" },
        label: "Retry fee estimate",
        variant: "secondary",
      },
    )}`;
  }
  return "";
};

/**
 * Renders decoded calls, risk flags, deployment context, and fee state. All
 * untrusted review copy passes through the shared escaped renderers.
 */
export const reviewPanelHtml = (review: TransferReview): string =>
  `${reviewCallsList(review.summaries)}${reviewPanel([
    ...riskFlagMessages(review.flags),
    ...(review.requiresDeployment
      ? ["This account is not deployed yet; the first send also submits its deployment."]
      : []),
  ])}${feeLineHtml(review)}`;
