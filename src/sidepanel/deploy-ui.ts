/**
 * Deploy-account button binding. Split from the side panel entrypoint into its
 * own per-feature bind module (matching reveal-ui/transfer-ui) so the
 * entrypoint stays within the file-size budget. Operates only on the passed-in
 * app element and routes all chain work through the wallet runtime.
 */
import { buttonBusy, errorMessage, scopedStatus, showToast } from "./dom";
import type { SidepanelWallet } from "./runtime";

/**
 * Dependencies for the deploy-account binding.
 */
export type DeployUiDeps = {
  readonly app: Element | null;
  readonly wallet: SidepanelWallet;
};

/**
 * Binds the "deploy account" button; safe to call on every render and a no-op
 * when the button is not on screen.
 */
export const bindDeploy = (deps: DeployUiDeps): void => {
  const button = deps.app?.querySelector<HTMLButtonElement>("#deploy-button");
  button?.addEventListener("click", () => {
    buttonBusy(button, true);
    scopedStatus(button, "Submitting deployment...");
    void deps.wallet.deployAccount().then(
      (transactionHash) => {
        showToast("Deployment submitted", "success");
        scopedStatus(button, `Deployment submitted: ${transactionHash}`);
        buttonBusy(button, false);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Deployment failed"), "error");
        scopedStatus(button, errorMessage(error, "Deployment failed"));
        buttonBusy(button, false);
      },
    );
  });
};
