/**
 * The Send journey's way-out controls: the receipt's finishing button and the
 * links from the receipt, pending and failure screens to Activity. Wiring only;
 * the journey decides what finishing means and owns navigation.
 */
import type { TransferExitView } from "./transfer-model";

/**
 * Binds the finishing button and the Activity links on a mounted Send form.
 * `completionTarget` names the flow Send was opened for; a multisig deployment
 * returns to that deployment instead of reading "Back".
 */
export const bindTransferExits = (
  form: HTMLFormElement,
  deps: {
    readonly complete: () => void;
    readonly completionTarget: string;
    readonly navigate?: ((view: TransferExitView) => void) | undefined;
  },
): void => {
  const homeButton = form.querySelector<HTMLButtonElement>("#send-home");
  if (homeButton) {
    homeButton.textContent =
      deps.completionTarget === "multisig-deploy" ? "Deploy Multisignature Account" : "Back";
    homeButton.addEventListener("click", deps.complete);
  }
  for (const id of ["#send-view-activity", "#send-pending-activity", "#send-failure-activity"]) {
    form.querySelector(id)?.addEventListener("click", () => deps.navigate?.("activity"));
  }
};
