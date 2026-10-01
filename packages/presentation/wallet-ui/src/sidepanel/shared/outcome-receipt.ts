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
 * confirmed, or beside one the chain rejected or reverted, is the failure this
 * shape exists to prevent.
 */

import { button } from "@bramble/ui-kit/controls";
import { setText } from "../journeys/send/transfer-progress-ui";
import type { ConfirmationOutcome } from "./confirm-submitted";
import { applyOutcomeHash, outcomeHashRow } from "./outcome-hash";

/** What one settled transaction is allowed to claim. */
export type OutcomeReceipt = {
  /** One line saying what now exists or moved, or why the chain refused it. */
  readonly description: string;
  /** The chain rejected or reverted it: the receipt carries the failure mark. */
  readonly failed: boolean;
  readonly hash: string;
  readonly title: string;
};

/**
 * Builds the receipt from the chain's answer, which has three endings, the same
 * three Swap has. Succeeded: the confirmed wording. Failed — rejected or
 * reverted: the failure title over the chain's reason, so a transaction that
 * did not land never reads as one that did. `null`, the journey running out of
 * patience — neither success nor failure: the wording drops to what is certain,
 * that it was submitted and is not confirmed yet.
 */
export const outcomeReceiptFor = (
  outcome: ConfirmationOutcome | null,
  copy: {
    readonly confirmedDescription: string;
    readonly confirmedTitle: string;
    readonly failedTitle: string;
    readonly submittedTitle: string;
  },
  hash: string,
): OutcomeReceipt => {
  if (!outcome) {
    return {
      description: "Not confirmed yet. Follow it in Activity.",
      failed: false,
      hash,
      title: copy.submittedTitle,
    };
  }
  return outcome.kind === "failed"
    ? { description: outcome.message, failed: true, hash, title: copy.failedTitle }
    : { description: copy.confirmedDescription, failed: false, hash, title: copy.confirmedTitle };
};

/**
 * Renders the section for `id`, hidden until its journey reveals it. Every
 * screen gets the same mark, heading, identifier row and ways on.
 *
 * Both marks and both sets of actions ship, and the paint shows one of each:
 * the receipt opens before the chain answers, so it has to be able to turn
 * into a failure in place. A receipt that stands — submitted or confirmed —
 * leads with Activity and offers Back. A failed one leads with Try again,
 * because the retry is the reader's next step, and keeps Activity, where the
 * failure can be looked up; leaving is the header's arrow. The pair and its
 * order are Send's failure screen's.
 */
export const outcomeReceiptSection = (id: string): string => `
  <section class="send-outcome send-success" id="${id}" role="status" aria-live="polite" hidden>
    <span class="send-outcome-mark" data-outcome-mark="succeeded" aria-hidden="true">
      <svg viewBox="0 0 56 56"><circle class="send-success-ring" cx="28" cy="28" r="25" /><path class="send-success-check" d="M18 29.5l7 7 14-15" /></svg>
    </span>
    <span class="send-outcome-mark" data-outcome-mark="failed" aria-hidden="true" hidden>
      <svg viewBox="0 0 56 56"><circle class="send-failure-ring" cx="28" cy="28" r="25" /><path class="send-failure-mark" d="m20 20 16 16m0-16L20 36" /></svg>
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
    <div class="send-actions" data-outcome-actions="succeeded">
      ${button({ attributes: { "data-outcome-action": "activity" }, icon: "activity", label: "View in Activity tab" })}
      ${button({ attributes: { "data-outcome-action": "home", "data-view": "home" }, label: "Back", variant: "secondary" })}
    </div>
    <div class="send-actions" data-outcome-actions="failed" hidden>
      ${button({ attributes: { "data-outcome-action": "retry" }, label: "Try again" })}
      ${button({ attributes: { "data-outcome-action": "activity" }, icon: "activity", label: "View in Activity tab", variant: "secondary" })}
    </div>
  </section>`;

/**
 * Wires the receipt's own controls for `id`. `retry` is the journey's: each
 * starts again from its own review, so a refused fee is never reused.
 *
 * Back carries `data-view`, which the shell binds once per render. A receipt
 * that is part of the rendered screen (the deployment) leaves it to that and
 * omits `home`; one inserted after the render (the NFT transfer) passes `home`,
 * or its Back does nothing. Passing `home` for a receipt the shell also binds
 * would navigate twice. Call once per rendered section — every call adds
 * listeners.
 */
export const bindOutcomeReceipt = (
  root: ParentNode,
  id: string,
  actions: {
    readonly activity: () => void;
    readonly home?: () => void;
    readonly retry: () => void;
  },
): void => {
  const section = root.querySelector(`#${id}`);
  section?.querySelectorAll('[data-outcome-action="activity"]').forEach((control) => {
    control.addEventListener("click", actions.activity);
  });
  section?.querySelector('[data-outcome-action="retry"]')?.addEventListener("click", actions.retry);
  if (actions.home) {
    section?.querySelector('[data-outcome-action="home"]')?.addEventListener("click", actions.home);
  }
};

/**
 * Writes the receipt into the section for `id` — mark, tone and actions
 * included. Safe to call on every paint.
 */
export const paintOutcomeReceipt = (
  root: ParentNode,
  id: string,
  receipt: OutcomeReceipt,
  networkId: string,
): void => {
  const section = root.querySelector(`#${id}`);
  section?.classList.toggle("send-success", !receipt.failed);
  section?.classList.toggle("send-failure", receipt.failed);
  section
    ?.querySelectorAll<HTMLElement>("[data-outcome-mark], [data-outcome-actions]")
    .forEach((part) => {
      const tone = part.dataset["outcomeMark"] ?? part.dataset["outcomeActions"];
      part.toggleAttribute("hidden", (tone === "failed") !== receipt.failed);
    });
  setText(root, `${id}-title`, receipt.title);
  setText(root, `${id}-description`, receipt.description);
  applyOutcomeHash(root, `${id}-hash`, receipt.hash, networkId);
};
