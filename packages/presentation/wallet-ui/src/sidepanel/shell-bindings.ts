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
  /** Captures the account/network whose deployment an async watcher may apply. */
  readonly deploymentScope?: () => DeploymentPollScope | null;
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

  // Both the tab-bar refresh control and the in-panel retry reload balances.
  app?.querySelectorAll<HTMLButtonElement>("[data-reload-balances]").forEach((button) => {
    button.addEventListener("click", () => {
      buttonBusy(button, true);
      void wallet.loadStatus().then(render, () => buttonBusy(button, false));
    });
  });
};

const DEPLOY_WATCH_ATTEMPTS = 12;
const DEPLOY_WATCH_INTERVAL_MS = 5_000;

/**
 * The slice of the shell deps the post-deploy watcher touches: the deployment
 * and status loaders plus the shell re-render. Kept narrower than
 * `ShellBindingDeps` so both this file and the transfer bindings (which have no
 * `setActiveView`) can drive it, and so tests can supply a minimal double.
 */
export type DeploymentWatchDeps = {
  readonly render: ShellBindingDeps["render"];
  readonly wallet: Pick<SidepanelWallet, "loadDeploymentStatus" | "loadStatus">;
};

/**
 * Account/network identity captured before a deployment is submitted.
 */
export type DeploymentPollScope = {
  readonly accountId: string;
  readonly stillCurrent: () => boolean;
};

/**
 * Captures an active deployment scope and a live predicate for later polling.
 */
export const deploymentPollScope = (
  status: Pick<WalletStatus, "activeAccountId" | "networkId">,
  current: () => Pick<WalletStatus, "activeAccountId" | "networkId">,
): DeploymentPollScope | null => {
  const accountId = status.activeAccountId;
  const networkId = status.networkId;
  return accountId === null
    ? null
    : {
        accountId,
        stillCurrent: () => {
          const latest = current();
          return latest.activeAccountId === accountId && latest.networkId === networkId;
        },
      };
};

/**
 * Polls deployment status a bounded number of times after a deploy is
 * submitted, re-rendering once the account reports deployed so the home
 * "deploy now" banner clears on its own — the design has no background tx
 * poller, and submitting a deploy triggers no render by itself. Stops silently
 * once the attempt budget is spent (a manual refresh stays the fallback) and
 * treats a failed status load as "not yet deployed". Fire-and-forget: callers
 * `void` it.
 */
export const watchDeployment = async (
  deps: DeploymentWatchDeps,
  scope: DeploymentPollScope,
  options: { readonly attempts?: number; readonly intervalMs?: number } = {},
): Promise<void> => {
  if (await awaitDeployment(deps.wallet, scope, options)) {
    const status = await deps.wallet.loadStatus();
    if (scope.stillCurrent() && status.activeAccountId === scope.accountId) {
      await deps.render(status);
    }
  }
};

/**
 * Waits for a submitted deployment to report deployed, answering whether it
 * did within the attempt budget. THE deployment poll — `watchDeployment` adds a
 * re-render on top, and a caller that must sequence work after deployment (the
 * deploy-then-register journey) needs the answer rather than a repaint. A failed
 * status load counts as "not yet".
 */
export const awaitDeployment = async (
  wallet: Pick<SidepanelWallet, "loadDeploymentStatus">,
  scope: DeploymentPollScope,
  options: { readonly attempts?: number; readonly intervalMs?: number } = {},
): Promise<boolean> => {
  const attempts = options.attempts ?? DEPLOY_WATCH_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEPLOY_WATCH_INTERVAL_MS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!scope.stillCurrent()) return false;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, intervalMs);
    });
    if (!scope.stillCurrent()) return false;
    const deployment = await wallet.loadDeploymentStatus().catch(() => null);
    if (deployment && deployment.accountId !== scope.accountId) {
      // The background always resolves the active account. A different id
      // proves the user switched while this poll was in flight, so stop rather
      // than observing or applying the new account's deployment.
      return false;
    }
    if (deployment?.deployed && scope.stillCurrent()) {
      return true;
    }
  }
  return false;
};

/**
 * Binds the account-deployment action.
 */
export const bindDeploy = (deps: ShellBindingDeps): void => {
  const button = deps.app?.querySelector<HTMLButtonElement>("#deploy-button");
  button?.addEventListener("click", () => {
    const scope = deps.deploymentScope?.() ?? null;
    buttonBusy(button, true);
    scopedStatus(button, "Submitting deployment...");
    void deps.wallet.deployAccount().then(
      (transactionHash) => {
        showToast("Deployment submitted", "success");
        scopedStatus(button, `Deployment submitted: ${transactionHash}`);
        buttonBusy(button, false);
        // Nothing else re-renders after a deploy submit, so watch for the
        // account going live and clear the "deploy now" banner when it does.
        if (scope) void watchDeployment(deps, scope);
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
 * Binds the network and account pickers. A network switch returns to Settings;
 * selecting an account means "use this account", so it lands on Home showing the
 * now-active account (matching the drawer's account tap) rather than returning to
 * the entry point. The flow header's back control still pops the nav history, so
 * Back returns to wherever the manage view was opened from.
 */
export const bindPickers = (deps: ShellBindingDeps): void => {
  const { app, wallet, render, setActiveView } = deps;
  const result = app?.querySelector<HTMLElement>("#picker-result");

  app?.querySelectorAll<HTMLButtonElement>("[data-network-id]").forEach((button) => {
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
      const accountId = button.dataset["accountId"];
      if (!accountId || button.getAttribute("aria-pressed") === "true") {
        return;
      }
      buttonBusy(button, true);
      if (result) {
        result.textContent = "Switching account...";
      }
      void wallet.setActiveAccount(accountId).then(
        async () => {
          // Picking an account is "use this account": land on Home showing the
          // now-active account instead of returning to the entry point.
          setActiveView("home");
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
