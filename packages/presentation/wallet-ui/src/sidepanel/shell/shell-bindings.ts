/**
 * Event bindings for the dashboard chrome: the lock/refresh controls and the
 * network/account pickers, plus the account-deployment binder re-exported from
 * `deploy-bindings`. Extracted from
 * the side panel entrypoint so the render loop stays within the file-size
 * budget; each binder is safe to call after every render and closes over the
 * shared state accessors passed in `ShellBindingDeps`.
 */
import { buttonBusy, errorDetails, errorLine, showToast } from "../shared/dom";
import { bindReceiveWalletCard } from "./dashboard-bindings";
import type { ShellBindingDeps } from "./shell-binding-deps";

/** The deploy binder and post-deploy watchers, kept importable from here. */
export {
  awaitDeployment,
  bindDeploy,
  DEPLOY_RECEIPT_COPY,
  type DeploymentWatchDeps,
  deploymentPollScope,
  watchDeployment,
} from "./deploy-bindings";
/** The shared binder deps, kept importable from here. */
export type { DeploymentPollScope, ShellBindingDeps } from "./shell-binding-deps";

/**
 * Binds the dashboard lock and refresh controls.
 */
export const bindDashboard = (deps: ShellBindingDeps): void => {
  const { app, wallet, render } = deps;
  bindReceiveWalletCard({ app, render, wallet });
  const lockButton = app?.querySelector<HTMLButtonElement>("#lock-button");
  const result = app?.querySelector<HTMLElement>("#panel-result");

  lockButton?.addEventListener("click", () => {
    buttonBusy(lockButton, true);
    void wallet.lockVault().then(
      (status) => {
        showToast("Vault locked", "success", lockButton);
        void render(status, "action");
      },
      (error: unknown) => {
        showToast(errorDetails(error, "Lock failed"), "error", lockButton);
        if (result) {
          result.textContent = errorLine(error, "Lock failed");
        }
        buttonBusy(lockButton, false);
      },
    );
  });

  // Both the tab-bar refresh control and the in-panel retry reload balances.
  // They refresh as an action, so the background refetches rather than serving
  // the snapshot it already holds — a refresh that returns the cache is not one.
  app?.querySelectorAll<HTMLButtonElement>("[data-reload-balances]").forEach((button) => {
    button.addEventListener("click", () => {
      buttonBusy(button, true);
      void wallet.loadStatus().then(
        (status) => render(status, "action"),
        () => buttonBusy(button, false),
      );
    });
  });
};

/**
 * Binds the network picker. A network switch returns to Settings. Accounts are
 * switched in the drawer, which carries its own binding — the manage view lists
 * accounts to name and to file into folders, never to select. Only picker
 * buttons bind: the Send form carries `data-network-id` as plain data, and
 * binding it would turn every click inside the form into a switch.
 */
export const bindPickers = (deps: ShellBindingDeps): void => {
  const { app, wallet, render, setActiveView } = deps;
  const result = app?.querySelector<HTMLElement>("#picker-result");

  // Buttons only. The attribute alone once matched a form that carried the
  // network for its own reasons, and every click inside it bubbled up here —
  // switching network and leaving for settings.
  app?.querySelectorAll<HTMLButtonElement>("button[data-network-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const networkId = button.dataset["networkId"];
      if (!networkId || button.getAttribute("aria-pressed") === "true") {
        return;
      }
      buttonBusy(button, true);
      if (result) {
        result.textContent = "Switching network...";
      }
      void wallet.setActiveNetwork(networkId).then(
        async (status) => {
          setActiveView("settings");
          showToast("Network switched", "success", button);
          await render(status, "action");
        },
        (error: unknown) => {
          showToast(errorDetails(error, "Network switch failed"), "error", button);
          if (result) {
            result.textContent = errorLine(error, "Network switch failed");
          }
          buttonBusy(button, false);
        },
      );
    });
  });
};
