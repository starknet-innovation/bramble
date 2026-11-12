/**
 * Staking screen bindings (issue 750). Each action is two taps, like the
 * in-wallet swap: the first asks the background to build, verify and price
 * the exact calls and shows its sentence for what will be signed with the
 * maximum fee; the second confirms that one frozen preparation by id.
 *
 * A row has one review line, so it has at most one armed confirm: reviewing
 * another action in the row, or editing an amount, disarms the others. The
 * confirm therefore always signs the action whose review is on screen, even
 * when two preparations overlap.
 *
 * The review line moves to sit directly above the control it belongs to, and
 * that control's group (its amount form, or the row's action buttons) is
 * marked open, so the styles stack it: the typed amount, then the sentence and
 * fee, then the confirm. A refusal or an unknown outcome is marked with its
 * severity, so it never reads like the neutral review sentence.
 *
 * A confirm is the primary button whatever its action's resting style, as in
 * the stake review. A review of one of the row's action buttons (claim,
 * withdraw, cancel unstake) hides the row's other controls, so its confirm is
 * the last thing in the row, and shows Cancel as the way back; disarming the
 * row (Cancel, or any new review) shows them again.
 *
 * While a confirm in a row is being submitted, and after its outcome is
 * unknown, the row is locked: no other review starts, no amount edit or Cancel
 * clears its line, so nothing can hide a transaction that may be on chain or
 * invite a second one. A repaint brings the row back fresh.
 */

import { t } from "../../../i18n/messages";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { failureTone, isOutcomeUnknown } from "../../runtime/runtime-errors";
import { buttonBusy, errorDetails, errorLine, showToast } from "../../shared/dom";
import { formatFeeEstimate } from "../../shared/review-render";
import type { StakingAction } from "./staking-client";

const ARMED = new WeakMap<HTMLButtonElement, string>();
// The latest request per row. Every tap and every amount edit starts a new
// one, and an answer for an older request is ignored, so two overlapping
// preparations can never leave a confirm armed under another action's review.
const LATEST = new WeakMap<Element, number>();
const LABELS = new WeakMap<HTMLButtonElement, string>();
// Controls whose resting style is secondary; their confirm is primary.
const SECONDARY = new WeakSet<HTMLButtonElement>();
const ACTIONS: readonly StakingAction[] = [
  "stake",
  "claim",
  "unstake",
  "cancel-unstake",
  "withdraw",
];

/**
 * Dependencies the staking bindings close over.
 */
export type StakingUiDeps = {
  readonly app: Element | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: Pick<SidepanelWallet, "executeStaking" | "prepareStaking">;
};

const GROUP = ".staking-form, .staking-actions";
const OPEN = "data-staking-open";
// Marks a control an action-button review hid, so disarming shows exactly those.
const HELD = "data-staking-held";
const CANCEL = "[data-staking-cancel]";
// Marks a row whose confirm is in flight or ended with an unknown outcome.
const SUBMITTING = "data-staking-submitting";

const isLocked = (row: Element | null | undefined): boolean =>
  row?.hasAttribute(SUBMITTING) === true;

const isAction = (value: string | undefined): value is StakingAction =>
  ACTIONS.some((action) => action === value);

// Returns every confirm in the row to its unreviewed state and supersedes any
// request in flight. Returns the new request's generation.
const disarmRow = (row: Element | null): number => {
  const generation = (row ? (LATEST.get(row) ?? 0) : 0) + 1;
  if (row) LATEST.set(row, generation);
  row?.querySelectorAll(`[${OPEN}]`).forEach((group) => {
    group.removeAttribute(OPEN);
  });
  for (const held of row?.querySelectorAll<HTMLElement>(`[${HELD}]`) ?? []) {
    held.removeAttribute(HELD);
    held.hidden = false;
  }
  const cancel = row?.querySelector<HTMLElement>(CANCEL);
  if (cancel) cancel.hidden = true;
  row?.querySelectorAll<HTMLButtonElement>("[data-staking-action]").forEach((control) => {
    ARMED.delete(control);
    const label = LABELS.get(control);
    if (label) control.replaceChildren(label);
    if (SECONDARY.has(control)) control.classList.add("secondary");
  });
  return generation;
};

const isLatest = (row: Element | null, generation: number): boolean =>
  !row || LATEST.get(row) === generation;

// Hides the row's other controls while one of its action buttons is under
// review, and puts Cancel directly after that button.
const holdRow = (row: Element | null, button: HTMLButtonElement): void => {
  const group = button.closest(".staking-actions");
  if (!row || !group) return;
  const others = [
    ...row.querySelectorAll<HTMLElement>(".staking-form"),
    ...group.querySelectorAll<HTMLElement>("[data-staking-action]"),
  ].filter((control) => control !== button && !control.hidden);
  for (const control of others) {
    control.setAttribute(HELD, "");
    control.hidden = true;
  }
  const cancel = row.querySelector<HTMLElement>(CANCEL);
  if (cancel) button.after(cancel);
};

// Shows or withholds the row's Cancel. Only an action-button review has one.
const offerCancel = (row: Element | null, button: HTMLButtonElement, offer: boolean): void => {
  const cancel = row?.querySelector<HTMLElement>(CANCEL);
  if (cancel && button.closest(".staking-actions")) cancel.hidden = !offer || isLocked(row);
};

/**
 * Binds the staking screen's action buttons, amount fields and Cancel.
 */
export const bindStaking = ({ app, wallet }: StakingUiDeps): void => {
  app?.querySelectorAll<HTMLButtonElement>(CANCEL).forEach((cancel) => {
    cancel.addEventListener("click", () => {
      const row = cancel.closest(".staking-row");
      if (isLocked(row)) return;
      disarmRow(row);
      const review = row?.querySelector<HTMLElement>("[data-staking-review-for]");
      if (review) review.hidden = true;
    });
  });
  app?.querySelectorAll<HTMLButtonElement>("[data-staking-action]").forEach((button) => {
    LABELS.set(button, button.textContent ?? "");
    if (button.classList.contains("secondary")) SECONDARY.add(button);
    const action = button.dataset["stakingAction"];
    const key = button.dataset["stakingRow"] ?? "";
    const [staker = "", tokenId = ""] = key.split("|");
    const row = button.closest<HTMLElement>(".staking-row");
    const review = row?.querySelector<HTMLElement>("[data-staking-review-for]");
    const field = row?.querySelector<HTMLInputElement>(
      `[data-staking-amount="${CSS.escape(`${action ?? ""}|${key}`)}"]`,
    );
    let generation = 0;
    field?.addEventListener("input", () => {
      if (isLocked(row)) return;
      disarmRow(row ?? null);
      if (review) review.hidden = true;
    });
    // Puts the review line directly above this control and opens its group.
    const show = (text: string): void => {
      if (!review) return;
      button.before(review);
      button.closest(GROUP)?.setAttribute(OPEN, "");
      holdRow(row ?? null, button);
      delete review.dataset["severity"];
      review.hidden = false;
      review.textContent = text;
    };
    // A superseded request only releases its control; it shows nothing.
    const release = (): void => {
      buttonBusy(button, false);
      if (field) field.readOnly = false;
    };
    const fail = (error: unknown): void => {
      showToast(errorDetails(error, t("review.staking.failed")), failureTone(error), button);
      if (review) {
        review.textContent = errorLine(error, t("review.staking.failed"));
        review.dataset["severity"] = failureTone(error);
      }
      // A confirm whose reply was lost may be on chain: the control stays down
      // until the screen repaints, so it cannot invite a blind resend.
      if (!isOutcomeUnknown(error)) {
        row?.removeAttribute(SUBMITTING);
        buttonBusy(button, false);
        if (field) field.readOnly = false;
        offerCancel(row ?? null, button, true);
        if (SECONDARY.has(button)) button.classList.add("secondary");
      }
    };
    button.addEventListener("click", () => {
      if (!isAction(action) || !staker || !tokenId || isLocked(row)) return;
      const amount = field?.value.trim() ?? "";
      if (field && amount.length === 0) {
        field.focus();
        return;
      }
      const armed = ARMED.get(button);
      generation = disarmRow(row ?? null);
      buttonBusy(button, true);
      if (field) field.readOnly = true;
      show(t(armed ? "review.staking.submitting" : "review.staking.estimating"));
      offerCancel(row ?? null, button, !armed);
      // A confirm being submitted stays the primary button it was tapped as.
      if (armed) button.classList.remove("secondary");
      if (armed) {
        row?.setAttribute(SUBMITTING, "");
        void wallet.executeStaking(armed).then(() => {
          row?.removeAttribute(SUBMITTING);
          showToast(t("review.staking.submitted"), "success", button);
          if (review) review.textContent = t("review.staking.submittedFollow");
        }, fail);
        return;
      }
      // Only a preparation can be superseded: a confirm's failure is always
      // shown, and a lost confirm keeps its control down.
      const request = { action, ...(field ? { amount } : {}), staker, tokenId };
      void wallet.prepareStaking(request).then(
        (preparation) => {
          if (!isLatest(row ?? null, generation)) return release();
          const fee = formatFeeEstimate(preparation.reviewedFee);
          ARMED.set(button, preparation.id);
          // `preparation.review` is the background's English sentence.
          if (review) {
            review.textContent = t("review.staking.review", { fee, review: preparation.review });
          }
          button.replaceChildren(t("review.staking.confirm", { fee }));
          button.classList.remove("secondary");
          buttonBusy(button, false);
          if (field) field.readOnly = false;
        },
        (error: unknown) => (isLatest(row ?? null, generation) ? fail(error) : release()),
      );
    });
  });
};
