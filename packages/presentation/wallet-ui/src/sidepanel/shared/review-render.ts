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
import { button } from "@mc-wallet/ui-kit/controls";
import type { UiAttributes } from "@mc-wallet/ui-kit/html-attributes";
import { icon } from "./icons";
import { copyButton, formatFri } from "./parts";

/**
 * Fee state shared by the pre-sign review surfaces. The Send/NFT review
 * response and the dApp invoke approval DTO both satisfy this shape
 * structurally, so one renderer serves every surface and the fee presentation
 * cannot drift between them (issue 189).
 */
export type ReviewFeeState = {
  readonly fee: { readonly overallFee: string; readonly unit: string } | null;
  /**
   * Verdict of the shared fee-affordability predicate (issue 191). Only
   * "insufficient" renders a warning; "ok"/"unknown"/absent render nothing
   * extra.
   *
   * "insufficient" is a positive verdict — the balance was read and cannot cover
   * the transaction — so both confirm surfaces also disable their approve/send
   * control on it, and the notice below says so. The predicate still fails open:
   * an unreadable balance yields "unknown", which makes no claim and blocks
   * nothing.
   */
  readonly feeAffordability?: "insufficient" | "ok" | "unknown";
  /**
   * The node's own reason a fee estimate was rejected, rendered only alongside
   * `feeEstimateFailed`. Untrusted text — escaped before display, and shown
   * behind a disclosure with a copy control so the banner stays calm while the
   * reason remains readable and reportable.
   */
  readonly feeEstimateDetail?: string;
  readonly feeEstimateFailed?: boolean;
  readonly feeEstimatePending?: boolean;
  readonly requiresDeployment?: boolean;
};

// Shortfall notice appended under the fee line when the shared predicate says
// the STRK balance cannot cover the transaction (issue 191). Names the blocked
// control, because both surfaces disable it on this verdict — a notice that only
// warned would leave the user staring at a dead button with no reason given.
const shortfallHtml = (state: ReviewFeeState): string =>
  state.feeAffordability === "insufficient"
    ? `<p class="review-flag" role="alert">${icon("alert")}This account's STRK balance is less than this transaction needs, including the estimated network fee. Add STRK to continue — the network would reject it as it stands.</p>`
    : "";

// The node's own rejection reason, kept behind a disclosure so the default view
// stays calm while the text remains selectable and one click from the clipboard
// — "check your connection" is the wrong story for the common case, an estimate
// that executed the calls and reverted. Escaped: this is untrusted node output.
const feeDetailHtml = (state: ReviewFeeState): string =>
  state.feeEstimateDetail === undefined || state.feeEstimateDetail === ""
    ? ""
    : `<details class="disclosure review-fee-detail">
    <summary><span class="menu-copy"><strong>Why it failed</strong><span>The network's own reason</span></span><span class="disclosure-mark">${icon("chevronRight")}</span></summary>
    <div class="disclosure-body">
      <code>${escapeHtml(state.feeEstimateDetail)}</code>
      ${copyButton(state.feeEstimateDetail, "Copy fee estimate error")}
    </div>
  </details>`;

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
    return '<p class="review-fee" role="status">Estimating network fee…</p>';
  }
  if (state.fee) {
    return `<p class="review-fee">Estimated fee: ${escapeHtml(formatFeeEstimate(state.fee))}</p>${shortfallHtml(state)}`;
  }
  if (state.requiresDeployment === true) {
    return '<p class="review-fee">The network fee is estimated once this account is deployed.</p>';
  }
  if (state.feeEstimateFailed === true) {
    return `<p class="review-flag" role="alert">Couldn't estimate the network fee right now. Check your connection and retry before sending.</p>${feeDetailHtml(
      state,
    )}${button({
      attributes: retryAttributes,
      label: "Retry fee estimate",
      variant: "secondary",
    })}`;
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
    : `<ul class="review-calls">${summaries
        .map((summary) => `<li class="review-call">${escapeHtml(summary)}</li>`)
        .join("")}</ul>`;

/**
 * Renders risk-flag and insight lines inside the shared review panel. Returns an
 * empty string when there is nothing to surface, so an absent panel leaves no
 * empty box behind rather than an empty bordered region.
 */
export const reviewPanel = (items: readonly string[]): string =>
  items.length === 0
    ? ""
    : `<div class="review-panel" role="note">${items
        .map((item) => `<p class="review-flag">${icon("alert")}${escapeHtml(item)}</p>`)
        .join("")}</div>`;

/**
 * Extracts the user-facing messages from risk flags so both review surfaces
 * feed the shared panel the same way. Accepts any flag-shaped value (the
 * background's `ApprovalRiskFlag` and the transfer review's flag share this
 * structure), keeping the two callers on one path.
 */
export const riskFlagMessages = (
  flags: readonly { readonly message: string }[],
): readonly string[] => flags.map((flag) => flag.message);
