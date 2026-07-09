/**
 * Event bindings for the dashboard chrome: the lock/refresh controls, the
 * account-deployment action, and the network/account pickers. Extracted from
 * the side panel entrypoint so the render loop stays within the file-size
 * budget; each binder is safe to call after every render and closes over the
 * shared state accessors passed in `ShellBindingDeps`.
 */
import type { WalletStatus } from "../popup/responses";
import { buttonBusy, errorMessage, scopedStatus, showToast } from "./dom";
import type { SidepanelWallet } from "./runtime";
import type { WalletView } from "./views";

/**
 * Services and state setters the shell bindings close over. State lives in the
 * entrypoint so it survives full re-renders.
 */
export type ShellBindingDeps = {
  readonly app: Element | null;
  readonly wallet: SidepanelWallet;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly setActiveView: (view: WalletView) => void;
};

/**
 * Binds the dashboard lock and refresh controls.
 */
export const bindDashboard = (deps: ShellBindingDeps): void => {
  const { app, wallet, render } = deps;
  const lockButton = app?.querySelector<HTMLButtonElement>("#lock-button");
  const refreshButton = app?.querySelector<HTMLButtonElement>("#refresh-button");
  const result = app?.querySelector<HTMLElement>("#panel-result");

  lockButton?.addEventListener("click", () => {
    buttonBusy(lockButton, true);
    void wallet.lockVault().then(
      (status) => {
        showToast("Vault locked", "success");
        void render(status);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Lock failed"), "error");
        if (result) {
          result.textContent = errorMessage(error, "Lock failed");
        }
        buttonBusy(lockButton, false);
      },
    );
  });

  refreshButton?.addEventListener("click", () => {
    buttonBusy(refreshButton, true);
    void wallet.loadStatus().then(render, () => buttonBusy(refreshButton, false));
  });
};

/**
 * Binds the account-deployment action.
 */
export const bindDeploy = (deps: ShellBindingDeps): void => {
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

/**
 * Binds the network and account pickers, returning to Settings after a switch.
 */
export const bindPickers = (deps: ShellBindingDeps): void => {
  const { app, wallet, render, setActiveView } = deps;
  const result = app?.querySelector<HTMLElement>("#picker-result");

  app?.querySelectorAll<HTMLButtonElement>("[data-network-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const networkId = button.dataset.networkId;
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
          showToast("Network switched", "success");
          await render(status);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Network switch failed"), "error");
          if (result) {
            result.textContent = errorMessage(error, "Network switch failed");
          }
          buttonBusy(button, false);
        },
      );
    });
  });

  app?.querySelectorAll<HTMLButtonElement>("[data-account-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const accountId = button.dataset.accountId;
      if (!accountId || button.getAttribute("aria-pressed") === "true") {
        return;
      }
      buttonBusy(button, true);
      if (result) {
        result.textContent = "Switching account...";
      }
      void wallet.setActiveAccount(accountId).then(
        async () => {
          setActiveView("settings");
          showToast("Account switched", "success");
          await render(await wallet.loadStatus());
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Account switch failed"), "error");
          if (result) {
            result.textContent = errorMessage(error, "Account switch failed");
          }
          buttonBusy(button, false);
        },
      );
    });
  });
};
