/**
 * Deploy-then-register: the one-action path for a funded account that is not
 * on-chain yet.
 *
 * Pool registration is an `INVOKE` from the account, so the account contract has
 * to exist first — and account deployment is a `DEPLOY_ACCOUNT` transaction,
 * which Starknet cannot batch with an invoke. There is no multicall that does
 * both. What this does instead is sequence them behind one control: submit the
 * deployment, wait for the account to report deployed, then open the registration
 * review. Two transactions and two fees, one user action.
 */

import { buttonBusy, errorMessage, showToast } from "./dom";
import type { SidepanelWallet } from "./runtime";
import { awaitDeployment } from "./shell-bindings";

/**
 * Collaborators for the deploy-then-register control. `startRegistration` runs
 * the ordinary registration journey, so both entry points reach the identical
 * review.
 */
export type DeployAndRegisterDeps = {
  readonly app: Element | null;
  readonly startRegistration: () => void;
  readonly wallet: Pick<SidepanelWallet, "deployAccount" | "loadDeploymentStatus">;
};

/**
 * Binds the deploy-then-register control when the current render offers it.
 * Safe to call on every paint; no-ops when the control is absent.
 */
export const bindDeployAndRegister = (deps: DeployAndRegisterDeps): void => {
  const button = deps.app?.querySelector<HTMLButtonElement>("[data-privacy-deploy-register]");
  if (!button) {
    return;
  }
  button.addEventListener("click", () => {
    buttonBusy(button, true);
    showToast("Deploying this account first…", "success");
    void deps.wallet.deployAccount().then(
      async (transactionHash) => {
        // The deployment is irreversible from here, so the only question left is
        // whether it lands in time to continue automatically.
        const deployed = await awaitDeployment(deps.wallet);
        buttonBusy(button, false);
        if (!deployed) {
          showToast(
            `Deployment ${transactionHash.slice(0, 10)}… is still settling. Register once it lands.`,
            "error",
          );
          return;
        }
        deps.startRegistration();
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Deployment failed"), "error");
        buttonBusy(button, false);
      },
    );
  });
};
