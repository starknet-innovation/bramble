/**
 * Confirmation watch for a submitted Send. Polls activity until Starknet
 * reports a pre-confirmation or a terminal status, and binds "Check again"
 * to the same watch. Split from the Send binding so that file stays within
 * the size budget.
 */

import type { SidepanelWallet } from "../../runtime/runtime";
import { awaitConfirmation } from "../../shared/confirm-submitted";
import { showToast } from "../../shared/dom";
import type { TransferState } from "./transfer-model";
import { transferRoute } from "./transfer-route";
import { confirmedState } from "./transfer-submit";

type ConfirmDeps = {
  readonly confirmationDelaysMs?: readonly number[];
  readonly onPrivateSendConfirmed?: () => void;
  readonly waitForConfirmation?: (delayMs: number) => Promise<void>;
  readonly wallet: Pick<SidepanelWallet, "loadActivity">;
};

/**
 * Starts the confirmation watch and binds "Check again". Returns the watch
 * so a lost-reply settlement can resume it for the same epoch.
 */
export const bindTransferConfirmation = <Review>(input: {
  readonly deps: ConfirmDeps;
  readonly form: HTMLFormElement;
  readonly nextEpoch: () => number;
  readonly readEpoch: () => number;
  readonly readState: () => TransferState<Review>;
  readonly repaint: () => void;
  readonly writeState: (state: TransferState<Review>) => void;
}): ((epoch: number) => Promise<void>) => {
  const confirmSubmitted = async (epoch: number): Promise<void> => {
    const hash = input.readState().transactionHash;
    if (!hash) return;
    const outcome = await awaitConfirmation({
      ...(input.deps.confirmationDelaysMs ? { delaysMs: input.deps.confirmationDelaysMs } : {}),
      hash,
      loadActivity: () => input.deps.wallet.loadActivity(),
      stillCurrent: () => epoch === input.readEpoch(),
      ...(input.deps.waitForConfirmation ? { wait: input.deps.waitForConfirmation } : {}),
    });
    if (epoch !== input.readEpoch()) return;
    if (!outcome) {
      input.writeState({ ...input.readState(), stage: "pending" });
      input.repaint();
      return;
    }
    const next = confirmedState(input.readState(), outcome);
    input.writeState(next);
    input.repaint();
    // Only a confirmed private route moved a balance the indexer must catch up on.
    const settledRoute = next.fields ? transferRoute(next.fields).id : null;
    if (outcome.kind === "succeeded" && settledRoute !== null && settledRoute !== "public-public") {
      input.deps.onPrivateSendConfirmed?.();
    }
    showToast(outcome.toast, outcome.kind === "succeeded" ? "success" : "error", input.form);
  };
  input.form.querySelector("#send-check-again")?.addEventListener("click", () => {
    const epoch = input.nextEpoch();
    input.writeState({ ...input.readState(), stage: "confirming" });
    input.repaint();
    void confirmSubmitted(epoch);
  });
  return confirmSubmitted;
};
