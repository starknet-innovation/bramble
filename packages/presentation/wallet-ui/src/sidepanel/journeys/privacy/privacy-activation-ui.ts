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

import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import { formatFeeEstimate } from "../../shared/review-render";
import { awaitDeployment, type DeploymentPollScope } from "../../shell/shell-bindings";

const DEPLOYMENT_FEES = new WeakMap<HTMLButtonElement, FeeEstimate>();

/**
 * Collaborators for the deploy-then-register control. `startRegistration` runs
 * the ordinary registration journey, so both entry points reach the identical
 * review.
 */
export type DeployAndRegisterDeps = {
  readonly app: Element | null;
  readonly deploymentScope: () => DeploymentPollScope | null;
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
    const scope = deps.deploymentScope();
    if (!scope) {
      showToast("No active account is available to deploy", "error", button);
      return;
    }
    buttonBusy(button, true);
    showToast(
      DEPLOYMENT_FEES.has(button) ? "Deploying this account…" : "Estimating deployment fee…",
      "success",
      button,
    );
    const reviewedFee = DEPLOYMENT_FEES.get(button);
    if (reviewedFee) DEPLOYMENT_FEES.delete(button);
    void deps.wallet.deployAccount(reviewedFee).then(
      async (response) => {
        if (typeof response !== "string") {
          DEPLOYMENT_FEES.set(button, response);
          const fee = formatFeeEstimate(response);
          button.lastChild?.replaceWith(`Confirm deploy · ${fee}`);
          showToast(`Maximum deployment fee: ${fee}`, "success", button);
          buttonBusy(button, false);
          return;
        }
        // The deployment is irreversible from here, so the only question left is
        // whether it lands in time to continue automatically.
        const deployed = await awaitDeployment(deps.wallet, scope);
        buttonBusy(button, false);
        if (!scope.stillCurrent()) {
          return;
        }
        if (!deployed) {
          showToast(
            `Deployment ${response.slice(0, 10)}… is still settling. Register once it lands.`,
            "error",
            button,
          );
          return;
        }
        deps.startRegistration();
      },
      (error: unknown) => {
        DEPLOYMENT_FEES.delete(button);
        showToast(errorMessage(error, "Deployment failed"), "error", button);
        buttonBusy(button, false);
      },
    );
  });
};
