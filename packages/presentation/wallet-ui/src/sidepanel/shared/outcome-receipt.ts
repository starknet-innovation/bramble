/**
 * The plain settled-transaction receipt: what happened, in one line, over the
 * identifier it happened under.
 *
 * Send and Swap end on richer versions of this — a sender/recipient sentence,
 * a pair of amounts — but account deployment and NFT transfer have nothing to
 * itemise, so they state the outcome, describe it once, and show the hash.
 * Shared so all four read as the same screen: same mark, same heading size,
 * same card, same identifier row.
 *
 * The title and description follow the chain's answer, never the handoff — see
 * ./confirm-submitted. A receipt that says "complete" beside a hash nothing has
 * confirmed is the failure this shape exists to prevent.
 */

import { escapeHtml } from "@bramble/core/html";
import { button } from "@bramble/ui-kit/controls";
import { setText } from "../journeys/send/transfer-progress-ui";
import type { ConfirmationOutcome } from "./confirm-submitted";
import { applyOutcomeHash, outcomeHashRow } from "./outcome-hash";

/** What one settled transaction is allowed to claim. */
export type OutcomeReceipt = {
  /** One line saying what now exists or moved. */
  readonly description: string;
  readonly hash: string;
  readonly title: string;
};

/**
 * Builds the receipt from the chain's answer. `null` is the journey running out
 * of patience — neither success nor failure — so the wording drops to what is
 * certain: it was submitted, and it is not confirmed yet.
 */
export const outcomeReceiptFor = (
  outcome: ConfirmationOutcome | null,
  copy: {
    readonly confirmedDescription: string;
    readonly confirmedTitle: string;
    readonly submittedTitle: string;
  },
  hash: string,
): OutcomeReceipt => ({
  description: outcome ? copy.confirmedDescription : "Not confirmed yet. Follow it in Activity.",
  hash,
  title: outcome ? copy.confirmedTitle : copy.submittedTitle,
});

/**
 * Renders the section for `id`, hidden until its journey reveals it. `actions`
 * is the caller's own markup, so each screen offers the next step that suits
 * it; every screen gets the same mark, heading and identifier row.
 */
export const outcomeReceiptSection = (id: string, actions: string): string => `
  <section class="send-outcome send-success" id="${id}" role="status" aria-live="polite" hidden>
    <span class="send-outcome-mark" aria-hidden="true">
      <svg viewBox="0 0 56 56"><circle class="send-success-ring" cx="28" cy="28" r="25" /><path class="send-success-check" d="M18 29.5l7 7 14-15" /></svg>
    </span>
    <div class="send-outcome-copy">
      <h2 id="${id}-title"></h2>
    </div>
    <div class="send-receipt">
      <p class="send-receipt-summary" id="${id}-description"></p>
      <div class="send-receipt-tx">
        <span class="send-receipt-label">Transaction</span>
        ${outcomeHashRow(`${id}-hash`)}
      </div>
    </div>
    <div class="send-actions">${actions}</div>
  </section>`;

/**
 * The two ways off a receipt, in the order every other outcome offers them.
 * `activityId` binds the Activity control; Back carries no id because it
 * navigates through the shared `data-view` handler.
 */
export const outcomeReceiptActions = (activityId: string): string =>
  `${button({ attributes: { id: escapeHtml(activityId) }, icon: "activity", label: "View in Activity tab" })}${button(
    { attributes: { "data-view": "home" }, label: "Back", variant: "secondary" },
  )}`;

/**
 * Writes the receipt into the section for `id`. Safe to call on every paint.
 */
export const paintOutcomeReceipt = (
  root: ParentNode,
  id: string,
  receipt: OutcomeReceipt,
  networkId: string,
): void => {
  setText(root, `${id}-title`, receipt.title);
  setText(root, `${id}-description`, receipt.description);
  applyOutcomeHash(root, `${id}-hash`, receipt.hash, networkId);
};
