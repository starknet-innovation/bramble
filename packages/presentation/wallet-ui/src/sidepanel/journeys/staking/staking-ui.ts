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
 */
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

const isAction = (value: string | undefined): value is StakingAction =>
  ACTIONS.some((action) => action === value);

// Returns every confirm in the row to its unreviewed state and supersedes any
// request in flight. Returns the new request's generation.
const disarmRow = (row: Element | null): number => {
  const generation = (row ? (LATEST.get(row) ?? 0) : 0) + 1;
  if (row) LATEST.set(row, generation);
  row?.querySelectorAll<HTMLButtonElement>("[data-staking-action]").forEach((control) => {
    ARMED.delete(control);
    const label = LABELS.get(control);
    if (label) control.replaceChildren(label);
  });
  return generation;
};

const isLatest = (row: Element | null, generation: number): boolean =>
  !row || LATEST.get(row) === generation;

/**
 * Binds the staking screen's action buttons and amount fields.
 */
export const bindStaking = ({ app, wallet }: StakingUiDeps): void => {
  app?.querySelectorAll<HTMLButtonElement>("[data-staking-action]").forEach((button) => {
    LABELS.set(button, button.textContent ?? "");
    const action = button.dataset["stakingAction"];
    const key = button.dataset["stakingRow"] ?? "";
    const [validatorId = "", tokenId = ""] = key.split("|");
    const row = button.closest<HTMLElement>(".staking-row");
    const review = row?.querySelector<HTMLElement>("[data-staking-review-for]");
    const field = row?.querySelector<HTMLInputElement>(
      `[data-staking-amount="${CSS.escape(`${action ?? ""}|${key}`)}"]`,
    );
    let generation = 0;
    field?.addEventListener("input", () => {
      disarmRow(row ?? null);
      if (review) review.hidden = true;
    });
    // A superseded request only releases its control; it shows nothing.
    const release = (): void => {
      buttonBusy(button, false);
      if (field) field.readOnly = false;
    };
    const fail = (error: unknown): void => {
      showToast(errorDetails(error, "Staking failed"), failureTone(error), button);
      if (review) review.textContent = errorLine(error, "Staking failed");
      // A confirm whose reply was lost may be on chain: the control stays down
      // until the screen repaints, so it cannot invite a blind resend.
      if (!isOutcomeUnknown(error)) {
        buttonBusy(button, false);
        if (field) field.readOnly = false;
      }
    };
    button.addEventListener("click", () => {
      if (!isAction(action) || !validatorId || !tokenId) return;
      const amount = field?.value.trim() ?? "";
      if (field && amount.length === 0) {
        field.focus();
        return;
      }
      const armed = ARMED.get(button);
      generation = disarmRow(row ?? null);
      buttonBusy(button, true);
      if (field) field.readOnly = true;
      if (review) {
        review.hidden = false;
        review.textContent = armed ? "Submitting…" : "Estimating the maximum fee…";
      }
      if (armed) {
        void wallet.executeStaking(armed).then(() => {
          showToast("Staking transaction submitted", "success", button);
          if (review) review.textContent = "Submitted. Follow it in Activity.";
        }, fail);
        return;
      }
      // Only a preparation can be superseded: a confirm's failure is always
      // shown, and a lost confirm keeps its control down.
      const request = { action, ...(field ? { amount } : {}), tokenId, validatorId };
      void wallet.prepareStaking(request).then(
        (preparation) => {
          if (!isLatest(row ?? null, generation)) return release();
          const fee = formatFeeEstimate(preparation.reviewedFee);
          ARMED.set(button, preparation.id);
          if (review) review.textContent = `${preparation.review} Maximum network fee: ${fee}.`;
          button.replaceChildren(`Confirm · ${fee}`);
          buttonBusy(button, false);
          if (field) field.readOnly = false;
        },
        (error: unknown) => (isLatest(row ?? null, generation) ? fail(error) : release()),
      );
    });
  });
};
