/**
 * Shared presentation for the pre-sign decode/risk layer, rendered identically
 * by the dApp approval invoke card (`approval-cards.ts`) and the in-wallet Send
 * review (`transfer-ui.ts`). The verify layer (`src/starknet/verify.ts`) is the
 * single source of truth for *what* a verification report contains; this module
 * is the single source of truth for *how* it is displayed, so the two review
 * surfaces stay at parity — the same structured decoded-calls list and the same
 * risk-flag panel for equivalent transactions. Returns escaped string HTML;
 * never trusts its inputs, so callers may pass decoded summaries and flag
 * messages directly.
 */
import { escapeHtml } from "../shared/html";
import { icon } from "./icons";

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
