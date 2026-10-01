/**
 * Event bindings for the dashboard chrome: the lock/refresh controls, the
 * account-deployment action, and the network/account pickers. Extracted from
 * the side panel entrypoint so the render loop stays within the file-size
 * budget; each binder is safe to call after every render and closes over the
 * shared state accessors passed in `ShellBindingDeps`.
 */
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { WalletStatus } from "../../popup/responses/responses";
import type { WalletView } from "../app/screens/views";
import type { SidepanelWallet } from "../runtime/runtime";
import { buttonBusy, errorMessage, renderFragment, scopedStatus, showToast } from "../shared/dom";
import { formatFeeEstimate, reviewConstraints } from "../shared/review-render";
import { bindReceiveWalletCard } from "./dashboard-bindings";

const DEPLOYMENT_FEES = new WeakMap<HTMLButtonElement, FeeEstimate>();

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
  bindReceiveWalletCard({ app, render, wallet });
  const lockButton = app?.querySelector<HTMLButtonElement>("#lock-button");
  const result = app?.querySelector<HTMLElement>("#panel-result");

  lockButton?.addEventListener("click", () => {
    buttonBusy(lockButton, true);
    void wallet.lockVault().then(
      (status) => {
        showToast("Vault locked", "success", lockButton);
        void render(status);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Lock failed"), "error", lockButton);
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
  const reviewPanelRoot = deps.app?.querySelector<HTMLElement>("#deploy-review");
  const reviewStage = deps.app?.querySelector<HTMLElement>("#deploy-review-stage");
  const successStage = deps.app?.querySelector<HTMLElement>("#deploy-success");
  const hash = deps.app?.querySelector<HTMLElement>("#deploy-hash");
  button?.addEventListener("click", () => {
    buttonBusy(button, true);
    scopedStatus(
      button,
      DEPLOYMENT_FEES.has(button) ? "Submitting deployment..." : "Estimating fee...",
    );
    const reviewedFee = DEPLOYMENT_FEES.get(button);
    if (reviewedFee) DEPLOYMENT_FEES.delete(button);
    void deps.wallet.deployAccount(reviewedFee).then(
      (response) => {
        if (typeof response !== "string") {
          DEPLOYMENT_FEES.set(button, response);
          const fee = formatFeeEstimate(response);
          if (reviewPanelRoot) {
            renderFragment(reviewPanelRoot, reviewConstraints(`Maximum network fee: ${fee}`));
          }
          scopedStatus(button, `Maximum network fee: ${fee}`);
          button.lastChild?.replaceWith(`Confirm deployment · ${fee}`);
          buttonBusy(button, false);
          return;
        }
        showToast("Deployment submitted", "success", button);
        if (hash) hash.textContent = response;
        reviewStage?.setAttribute("hidden", "");
        successStage?.removeAttribute("hidden");
        scopedStatus(button, "");
        buttonBusy(button, false);
      },
      (error: unknown) => {
        DEPLOYMENT_FEES.delete(button);
        if (reviewPanelRoot) renderFragment(reviewPanelRoot, "");
        showToast(errorMessage(error, "Deployment failed"), "error", button);
        scopedStatus(button, errorMessage(error, "Deployment failed"));
        buttonBusy(button, false);
      },
    );
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
          await render(status);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Network switch failed"), "error", button);
          if (result) {
            result.textContent = errorMessage(error, "Network switch failed");
          }
          buttonBusy(button, false);
        },
      );
    });
  });
};
