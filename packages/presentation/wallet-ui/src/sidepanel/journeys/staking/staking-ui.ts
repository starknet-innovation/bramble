/**
 * Staking screen bindings (issue 750). Each action is two taps, like the
 * allowance revoke: the first asks the background for the network fee of the
 * exact calls it will sign and shows what is about to be signed; the second
 * sends that reviewed fee and submits. Editing the amount after the review
 * discards it, so a confirm can never carry a figure the user did not see.
 */
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { failureTone, isOutcomeUnknown } from "../../runtime/runtime-errors";
import { buttonBusy, errorDetails, errorLine, showToast } from "../../shared/dom";
import { formatFeeEstimate } from "../../shared/review-render";
import type { StakingAction } from "./staking-client";

const REVIEWED = new WeakMap<HTMLButtonElement, FeeEstimate>();
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
  readonly wallet: Pick<SidepanelWallet, "stakingAction">;
};

/**
 * The sentence that says what the reviewed calls do. It is review text: edit
 * it only as part of the reviewed approval/signing group.
 */
export const stakingReviewText = (
  action: StakingAction,
  facts: { readonly amount: string; readonly symbol: string; readonly validator: string },
  fee: string,
): string => {
  const { amount, symbol, validator } = facts;
  const what: Readonly<Record<StakingAction, string>> = {
    "cancel-unstake": `Cancel your unstake and keep the ${symbol} staked with ${validator}.`,
    claim: `Claim your ${symbol} rewards from ${validator}.`,
    stake: `Stake ${amount} ${symbol} with ${validator}. This approves exactly ${amount} ${symbol} for its pool.`,
    unstake: `Unstake ${amount} ${symbol} from ${validator}. It earns no rewards until you withdraw it.`,
    withdraw: `Withdraw your unstaked ${symbol} from ${validator}.`,
  };
  return `${what[action]} Maximum network fee: ${fee}.`;
};

const isAction = (value: string | undefined): value is StakingAction =>
  ACTIONS.some((action) => action === value);

/**
 * Binds the staking screen's action buttons and amount fields.
 */
export const bindStaking = ({ app, wallet }: StakingUiDeps): void => {
  app?.querySelectorAll<HTMLButtonElement>("[data-staking-action]").forEach((button) => {
    const action = button.dataset["stakingAction"];
    const key = button.dataset["stakingRow"] ?? "";
    const [validatorId = "", tokenId = ""] = key.split("|");
    const row = button.closest<HTMLElement>(".staking-row");
    const review = row?.querySelector<HTMLElement>(
      `[data-staking-review-for="${CSS.escape(key)}"]`,
    );
    const field = row?.querySelector<HTMLInputElement>(
      `[data-staking-amount="${CSS.escape(`${action ?? ""}|${key}`)}"]`,
    );
    const label = button.textContent ?? "";
    field?.addEventListener("input", () => {
      REVIEWED.delete(button);
      button.replaceChildren(label);
      if (review) review.hidden = true;
    });
    button.addEventListener("click", () => {
      if (!isAction(action) || !validatorId || !tokenId) return;
      const amount = field?.value.trim() ?? "";
      if (field && amount.length === 0) {
        field.focus();
        return;
      }
      const reviewedFee = REVIEWED.get(button);
      REVIEWED.delete(button);
      buttonBusy(button, true);
      if (field) field.readOnly = true;
      if (review) {
        review.hidden = false;
        review.textContent = reviewedFee ? "Submitting…" : "Estimating the maximum fee…";
      }
      const request = { action, ...(field ? { amount } : {}), tokenId, validatorId };
      void wallet.stakingAction(request, reviewedFee).then(
        (response) => {
          if (typeof response !== "string") {
            REVIEWED.set(button, response);
            const fee = formatFeeEstimate(response);
            if (review) {
              review.textContent = stakingReviewText(
                action,
                {
                  amount,
                  symbol: row?.dataset["stakingSymbol"] ?? "",
                  validator: row?.dataset["stakingValidator"] ?? "",
                },
                fee,
              );
            }
            button.replaceChildren(`Confirm · ${fee}`);
            buttonBusy(button, false);
            if (field) field.readOnly = false;
            return;
          }
          showToast("Staking transaction submitted", "success", button);
          if (review) review.textContent = "Submitted. Follow it in Activity.";
        },
        (error: unknown) => {
          showToast(errorDetails(error, "Staking failed"), failureTone(error), button);
          if (review) review.textContent = errorLine(error, "Staking failed");
          // A submit whose reply was lost may be on chain: the control stays
          // down until the screen repaints, so it cannot invite a blind resend.
          if (!isOutcomeUnknown(error)) {
            button.replaceChildren(label);
            buttonBusy(button, false);
            if (field) field.readOnly = false;
          }
        },
      );
    });
  });
};
