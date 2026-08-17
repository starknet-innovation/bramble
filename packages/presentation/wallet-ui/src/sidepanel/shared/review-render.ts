/**
 * Shared presentation for the pre-sign decode/risk layer, rendered identically
 * by the dApp approval invoke card (`approval-cards.ts`) and the in-wallet Send
 * review (`transfer-ui.ts`). The transactions package verify layer is the
 * single source of truth for *what* a verification report contains; this module
 * is the single source of truth for *how* it is displayed, so the two review
 * surfaces stay at parity — the same structured decoded-calls list and the same
 * risk-flag panel for equivalent transactions. Returns escaped string HTML;
 * never trusts its inputs, so callers may pass decoded summaries and flag
 * messages directly.
 */
import { escapeHtml } from "@mc-wallet/core/html";
import type { FeeEstimate } from "@mc-wallet/starknet/fee-bounds";
import { button } from "@mc-wallet/ui-kit/controls";
import type { UiAttributes } from "@mc-wallet/ui-kit/html-attributes";
import { icon } from "./icons";
import { formatFri } from "./parts";

/**
 * Fee state shared by the pre-sign review surfaces. The Send/NFT review
 * response and the dApp invoke approval DTO both satisfy this shape
 * structurally, so one renderer serves every surface and the fee presentation
 * cannot drift between them (issue 189).
 */
export type ReviewFeeState = {
  readonly deploymentFee?: FeeEstimate | null;
  readonly deploymentFeeEstimateFailed?: boolean;
  readonly fee: FeeEstimate | null;
  /**
   * Verdict of the shared fee-affordability predicate (issue 191). Only
   * "insufficient" renders a warning; "ok"/"unknown"/absent render nothing
   * extra, and no surface gates a decision on it — the guard is warn-only and
   * fails open.
   */
  readonly feeAffordability?: "insufficient" | "ok" | "unknown";
  readonly feeEstimateFailed?: boolean;
  readonly feeEstimatePending?: boolean;
  readonly requiresDeployment?: boolean;
};

// Warn-only shortfall notice appended under the fee line when the shared
// predicate says the STRK balance cannot cover the transaction (issue 191).
const shortfallHtml = (state: ReviewFeeState): string =>
  state.feeAffordability === "insufficient"
    ? `<p class="review-flag" role="alert">${icon("alert")}This account's STRK balance is less than this transaction needs, including the estimated network fee. The network will likely reject it.</p>`
    : "";

const reviewBoundary = (content: string): string =>
  `<section class="decision-layer decision-boundary" aria-label="Maximum cost and constraints">
    <p class="decision-label">Maximum cost and constraints</p>
    ${content}
  </section>`;

/**
 * Renders a plain-language consequence for decisions that do not carry decoded
 * calls (connections, signatures, and configuration changes).
 */
export const reviewOutcome = (copy: string): string =>
  `<section class="decision-layer decision-outcome" aria-label="What will happen">
    <p class="decision-label">What will happen</p>
    <p>${escapeHtml(copy)}</p>
  </section>`;

/**
 * Renders a non-fee constraint statement through the same decision hierarchy
 * as a transaction fee ceiling.
 */
export const reviewConstraints = (copy: string): string =>
  reviewBoundary(`<p>${escapeHtml(copy)}</p>`);

/**
 * Formats a fee estimate in the unit the estimate actually returned: `FRI`
 * renders as STRK via {@link formatFri}-equivalent formatting, any other
 * accepted unit renders with its own label — so a `WEI` estimate can never be
 * mislabelled as STRK. Matches the declare card's existing behaviour.
 */
export const formatFeeEstimate = (fee: NonNullable<ReviewFeeState["fee"]>): string =>
  fee.unit === "FRI" ? formatFri(fee.overallFee) : `${fee.overallFee} ${fee.unit}`;

/**
 * Renders the shared fee section of a pre-sign review: the estimated fee when
 * one exists, the not-yet-deployed notice, or the estimate-failed alert with a
 * retry button carrying the caller's attributes (Send wires an id, the dApp
 * card a data attribute). Returns an empty string when there is no fee state to
 * surface. Escapes everything; a missing estimate is always a named state,
 * never a fabricated amount.
 */
export const reviewFeeSection = (state: ReviewFeeState, retryAttributes: UiAttributes): string => {
  if (state.feeEstimatePending === true) {
    return reviewBoundary('<p class="review-fee" role="status">Estimating network fee…</p>');
  }
  if (state.requiresDeployment === true && state.fee && state.deploymentFee) {
    return reviewBoundary(
      `<div class="review-fee"><p>Estimated transaction fee: ${escapeHtml(formatFeeEstimate(state.fee))}</p><p>Estimated account deployment fee: ${escapeHtml(formatFeeEstimate(state.deploymentFee))}</p></div>${shortfallHtml(state)}`,
    );
  }
  if (
    state.requiresDeployment === true &&
    state.deploymentFee === undefined &&
    state.deploymentFeeEstimateFailed === undefined &&
    state.feeEstimateFailed !== true
  ) {
    return reviewBoundary(
      '<p class="review-fee">The network fee is estimated once this account is deployed.</p>',
    );
  }
  if (state.requiresDeployment === true) {
    return reviewBoundary(
      `<p class="review-flag" role="alert">Couldn't estimate both the transaction and account deployment fees. Check your connection and retry before sending.</p>${button(
        {
          attributes: retryAttributes,
          label: "Retry fee estimate",
          variant: "secondary",
        },
      )}`,
    );
  }
  if (state.fee) {
    return reviewBoundary(
      `<p class="review-fee">Estimated fee: ${escapeHtml(formatFeeEstimate(state.fee))}</p>${shortfallHtml(state)}`,
    );
  }
  if (state.feeEstimateFailed === true) {
    return reviewBoundary(
      `<p class="review-flag" role="alert">Couldn't estimate the network fee right now. Check your connection and retry before sending.</p>${button(
        {
          attributes: retryAttributes,
          label: "Retry fee estimate",
          variant: "secondary",
        },
      )}`,
    );
  }
  return "";
};

/**
 * Renders decoded call summaries as a structured `review-calls` list — the same
 * markup the dApp invoke card uses. Returns an empty string when there are no
 * summaries, so callers can inline it unconditionally without leaving an empty
 * list behind.
 */
export const reviewCallsList = (summaries: readonly string[]): string =>
  summaries.length === 0
    ? ""
    : `<section class="decision-layer decision-outcome" aria-label="What will happen">
        <p class="decision-label">What will happen</p>
        <ul class="review-calls">${summaries
          .map((summary) => `<li class="review-call">${escapeHtml(summary)}</li>`)
          .join("")}</ul>
      </section>`;

/**
 * Renders risk-flag and insight lines inside the shared review panel. Returns an
 * empty string when there is nothing to surface, so an absent panel leaves no
 * empty box behind rather than an empty bordered region.
 */
export const reviewPanel = (items: readonly string[], clearCopy?: string): string =>
  items.length === 0
    ? clearCopy
      ? `<div class="review-panel decision-layer decision-risk" role="note">
          <p class="decision-label">Risk and recovery</p>
          <p>${escapeHtml(clearCopy)}</p>
        </div>`
      : ""
    : `<div class="review-panel decision-layer decision-risk" role="note">
        <p class="decision-label">Risk and recovery</p>
        ${items
          .map((item) => `<p class="review-flag">${icon("alert")}${escapeHtml(item)}</p>`)
          .join("")}
      </div>`;

/**
 * Extracts the user-facing messages from risk flags so both review surfaces
 * feed the shared panel the same way. Accepts any flag-shaped value (the
 * background's `ApprovalRiskFlag` and the transfer review's flag share this
 * structure), keeping the two callers on one path.
 */
export const riskFlagMessages = (
  flags: readonly { readonly message: string }[],
): readonly string[] => flags.map((flag) => flag.message);
