/**
 * Shared decoded-transfer review markup used by Send and NFT transfer flows.
 */
import { reviewCallsList, reviewFeeSection, reviewPanel, riskFlagMessages } from "./review-render";
import type { SidepanelWallet } from "./runtime";

type TransferReview = Awaited<ReturnType<SidepanelWallet["reviewTransfer"]>>;

/**
 * Renders the transfer fee state — the estimated amount, the pending-deployment
 * note, or the failed-estimate alert with its retry affordance (`""` when no
 * state applies). Delegates to the shared `reviewFeeSection` so every confirm
 * surface that promotes the fee — Send, NFT transfer, and the dApp invoke
 * card — renders one wording and one formatting (issues 189 and 190). Dynamic
 * copy is escaped before rendering.
 */
export const reviewFeeHtml = (review: TransferReview): string =>
  reviewFeeSection(review, { id: "review-retry-fee" });

/**
 * Renders decoded calls, risk flags, and deployment context without the fee
 * state, for surfaces that promote `reviewFeeHtml` onto their always-visible
 * confirm face. All untrusted review copy passes through the shared escaped
 * renderers.
 */
export const reviewDetailsHtml = (review: TransferReview): string =>
  `${reviewCallsList(review.summaries)}${reviewPanel([
    ...riskFlagMessages(review.flags),
    ...(review.requiresDeployment
      ? ["This account is not deployed yet; the first send also submits its deployment."]
      : []),
  ])}`;

/**
 * Renders decoded calls, risk flags, deployment context, and fee state. All
 * untrusted review copy passes through the shared escaped renderers.
 */
export const reviewPanelHtml = (review: TransferReview): string =>
  `${reviewDetailsHtml(review)}${reviewFeeHtml(review)}`;
