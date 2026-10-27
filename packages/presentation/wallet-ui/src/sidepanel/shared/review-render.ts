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
import { escapeHtml } from "@bramble/core/html";
import { type FeeEstimate, sumFeeEstimates } from "@bramble/starknet/fee-bounds";
import { formatTokenAmount } from "@bramble/starknet/rpc";
import { button } from "@bramble/ui-kit/controls";
import type { UiAttributes } from "@bramble/ui-kit/html-attributes";
import { tokenGlyph } from "../journeys/portfolio/token-row";
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
  /**
   * Set when the account signs on a device: deployment and the transaction are
   * two transactions, so the device prompts twice. Said here rather than left
   * as a surprise between the confirm press and the second prompt.
   */
  readonly signsTwice?: boolean;
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
  /**
   * Explicit alternatives when STRK does not cover the fee. The wallet does
   * not select one; each entry is a control the user can choose.
   */
  readonly gaslessFees?: readonly {
    readonly amount: string;
    readonly decimals: number;
    readonly label: string;
    readonly tokenAddress: string;
  }[];
  readonly requiresDeployment?: boolean;
};

// Warn-only shortfall notice appended under the fee line when the shared
// predicate says the STRK balance cannot cover the transaction (issue 191).
const shortfallHtml = (state: ReviewFeeState): string =>
  state.feeAffordability === "insufficient"
    ? `<p class="review-flag" role="alert">${icon("alert")}This account's STRK balance is less than this transaction needs, including the estimated network fee. The network will likely reject it.</p>`
    : "";

const gaslessChoiceHtml = (state: ReviewFeeState, attributes: UiAttributes): string => {
  // Offers are attached only after the spend-aware shortfall check. The
  // fee-only verdict can still be "ok" when the calls themselves spend the
  // STRK a fee-only comparison ignores, so a present list is rendered as-is.
  if (state.gaslessFees === undefined || state.gaslessFees.length === 0) {
    return "";
  }
  return state.gaslessFees
    .map((offer) => {
      let formatted = "";
      try {
        formatted = formatTokenAmount(BigInt(offer.amount), offer.decimals);
      } catch {
        return "";
      }
      return button({
        attributes: {
          ...attributes,
          "data-gasless-amount": offer.amount,
          "data-gasless-decimals": String(offer.decimals),
          "data-gasless-label": offer.label,
          "data-gasless-token": offer.tokenAddress,
        },
        label: `Pay up to ${formatted} ${offer.label}`,
        variant: "secondary",
      });
    })
    .join("");
};

/**
 * Whether this review has no single figure the user can consent to.
 *
 * A failed component, or two estimates that cannot be added (unlike units, a
 * malformed amount), fails closed. Callers withhold the reviewed key and
 * disable Confirm so the next click re-estimates instead of sending a figure
 * the review did not quote. A deployment whose fee is simply not ready yet
 * (no failure flag, no deployment estimate) is not blocked: that screen says
 * the fee comes after deployment.
 */
export const reviewFeeBlocked = (state: ReviewFeeState): boolean =>
  state.feeEstimateFailed === true ||
  state.deploymentFeeEstimateFailed === true ||
  (state.requiresDeployment === true &&
    state.fee != null &&
    state.deploymentFee != null &&
    sumFeeEstimates(state.fee, state.deploymentFee) === null);

// `rule: false` drops the hairline above the section, for a surface that already
// separates its own blocks and does not want a divider drawn inside them. The
// label must be true of the content: "Cost" over fee lines only.
const reviewBoundary = (content: string, rule = true, label = "Cost"): string =>
  `<section class="decision-layer${rule ? " decision-boundary" : ""}" aria-label="${label}">
    <p class="decision-label">${label}</p>
    ${content}
  </section>`;

/**
 * Wraps already-composed fee markup in the Cost box.
 *
 * `reviewFeeSection` builds and boxes its own lines, but the Send review also
 * composes fee lines for routes with no estimate to section — a relay's
 * sponsored gas, a deposit priced at submission. Those were the ones left
 * outside a box, beside a Visibility section that had one.
 */
export const reviewCostSection = (trustedMarkup: string): string =>
  reviewBoundary(trustedMarkup, false);

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
 * Renders a constraint statement — what the decision does not sign, charge or
 * authorize — through the same decision hierarchy as a fee ceiling. Labelled
 * "Cost and limits", not "Cost": a line such as "the signed result can still
 * authorize site-specific actions" is not fee information. Escapes `copy`.
 */
export const reviewConstraints = (copy: string): string =>
  reviewBoundary(`<p>${escapeHtml(copy)}</p>`, true, "Cost and limits");

/**
 * Renders one plain-text fee line (a maximum fee, or why there is none yet)
 * in the Cost box. Escapes `copy`.
 */
export const reviewCostNote = (copy: string): string =>
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
 * The one wording for an estimated network fee, shared by the pre-sign reviews
 * and the Send Amount screen so the same figure can never be phrased two ways.
 * Escapes nothing; callers place it in a text sink.
 */
export const estimatedFeeText = (fee: NonNullable<ReviewFeeState["fee"]>): string =>
  `Estimated fee: ${formatFeeEstimate(fee)}`;

/**
 * Renders the shared fee section of a pre-sign review: the estimated fee when
 * one exists, the not-yet-deployed notice, or the estimate-failed alert with a
 * retry button carrying the caller's attributes (Send wires an id, the dApp
 * card a data attribute). Returns an empty string when there is no fee state to
 * surface. Escapes everything; a missing estimate is always a named state,
 * never a fabricated amount.
 */
export const reviewFeeSection = (
  state: ReviewFeeState,
  retryAttributes: UiAttributes,
  options: {
    readonly extra?: string;
    /** Attributes copied onto each gasless choice, such as the approval id. */
    readonly gaslessAttributes?: UiAttributes;
    /**
     * The pool's own charge, in FRI. Given it, the section adds the total of
     * what will actually leave the account — the arithmetic belongs here
     * because only this function knows which network figure it printed.
     */
    readonly poolFeeFri?: string;
    readonly rule?: boolean;
  } = {},
): string => {
  const { extra = "", gaslessAttributes = {}, poolFeeFri, rule = true } = options;
  // Two fees on one screen is two numbers to add up. Stated only when both are
  // known and share a denomination; an unlike pair fails closed rather than
  // printing a total that means nothing.
  const totalLine = (network: FeeEstimate): string => {
    // Unlike denominations fail closed: a total that adds FRI to anything else
    // would understate the cost exactly as a missing half does.
    if (poolFeeFri === undefined || network.unit !== "FRI") {
      return "";
    }
    try {
      // Both figures reach here as base units, but the pool quotes hex and an
      // estimate may be decimal, so each is parsed rather than compared as text.
      const total = BigInt(network.overallFee) + BigInt(poolFeeFri);
      return `<p class="review-fee review-fee-total">Total fees: ${escapeHtml(
        formatFri(`0x${total.toString(16)}`),
      )}</p>`;
    } catch {
      return "";
    }
  };
  // Every branch closes the same way, so a caller's extra cost line lands
  // inside the section rather than orphaned under it.
  const boundary = (content: string, network?: FeeEstimate): string =>
    reviewBoundary(`${content}${extra}${network ? totalLine(network) : ""}`, rule);
  if (state.feeEstimatePending === true) {
    return boundary('<p class="review-fee" role="status">Estimating network fee…</p>');
  }
  if (state.requiresDeployment === true && state.fee && state.deploymentFee) {
    // One action, one figure. Creating the account and sending are two
    // transactions on chain and the user pays for both, so the total leads and
    // the deployment share is named under it — quoting the transaction alone
    // understates what leaves the account, and quoting two figures asks the
    // user to add them up.
    const total = sumFeeEstimates(state.fee, state.deploymentFee);
    // Unlike units or a malformed estimate fail closed: quoting one component
    // as the total would understate the cost the same way a missing half does.
    if (total) {
      return boundary(
        `<div class="review-fee"><p>${escapeHtml(
          estimatedFeeText(total),
        )}</p><p class="review-fee-part">Creating this account on Starknet is ${escapeHtml(
          formatFeeEstimate(state.deploymentFee),
        )} of that${state.signsTwice === true ? ", and your Ledger asks to sign both" : ""}.</p></div>${shortfallHtml(state)}`,
        total,
      );
    }
  }
  if (
    state.requiresDeployment === true &&
    state.deploymentFee === undefined &&
    state.deploymentFeeEstimateFailed === undefined &&
    state.feeEstimateFailed !== true
  ) {
    return boundary(
      '<p class="review-fee">The network fee is estimated once this account is deployed.</p>',
    );
  }
  if (state.requiresDeployment === true) {
    return boundary(
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
    return boundary(
      `<p class="review-fee">${escapeHtml(estimatedFeeText(state.fee))}</p>${shortfallHtml(state)}${gaslessChoiceHtml(state, gaslessAttributes)}`,
      state.fee,
    );
  }
  if (state.feeEstimateFailed === true) {
    return boundary(
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
export const reviewCallsList = (
  summaries: readonly string[],
  assets: readonly { readonly address: string; readonly symbol: string }[] = [],
): string =>
  summaries.length === 0
    ? ""
    : `<section class="decision-layer decision-outcome" aria-label="What will happen">
        <p class="decision-label">What will happen</p>
        <ul class="review-calls">${summaries
          .map((summary) => {
            const words = new Set(summary.toUpperCase().match(/[A-Z0-9.]+/gu) ?? []);
            const marks = assets
              .filter((asset) => words.has(asset.symbol.toUpperCase()))
              .map((asset) => tokenGlyph(asset.address, asset.symbol))
              .join("");
            return `<li class="review-call">${marks ? `<span class="review-call-assets">${marks}</span>` : ""}<span>${escapeHtml(summary)}</span></li>`;
          })
          .join("")}</ul>
      </section>`;

/**
 * Renders risk-flag and insight lines inside the shared review panel. Returns an
 * empty string when there is nothing to surface, so an absent panel leaves no
 * empty box behind rather than an empty bordered region.
 *
 * The "Risk and recovery" label belongs to the flag list. `clearCopy` is the
 * opposite of a flag — a neutral statement about what the action does, shown
 * when nothing was flagged — so it renders unlabelled rather than under a
 * heading announcing a risk the panel is not reporting.
 */
export const reviewPanel = (items: readonly string[], clearCopy?: string): string =>
  items.length === 0
    ? clearCopy
      ? `<div class="review-panel decision-layer decision-risk" role="note">
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
