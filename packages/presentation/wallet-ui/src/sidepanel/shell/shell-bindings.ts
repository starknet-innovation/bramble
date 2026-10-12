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
import type { RefreshReason } from "../app/sync/refresh-scheduler";
import type { SidepanelWallet } from "../runtime/runtime";
import { isOutcomeUnknown } from "../runtime/runtime-errors";
import { awaitConfirmation, type ConfirmationOutcome } from "../shared/confirm-submitted";
import {
  buttonBusy,
  errorLine,
  errorMessage,
  renderFragment,
  scopedStatus,
  showToast,
} from "../shared/dom";
import {
  bindOutcomeReceipt,
  outcomeReceiptFor,
  paintOutcomeReceipt,
} from "../shared/outcome-receipt";
import { formatFeeEstimate, reviewCostNote } from "../shared/review-render";
import { bindReceiveWalletCard } from "./dashboard-bindings";

const DEPLOYMENT_FEES = new WeakMap<HTMLButtonElement, FeeEstimate>();
// Controls whose screen has already asked for a quote, so a repaint does not.
const QUOTED_DEPLOYMENTS = new WeakSet<HTMLButtonElement>();

/**
 * Services and state setters the shell bindings close over. State lives in the
 * entrypoint so it survives full re-renders.
 */
export type ShellBindingDeps = {
  readonly app: Element | null;
  /** Captures the account/network whose deployment an async watcher may apply. */
  readonly deploymentScope?: () => DeploymentPollScope | null;
  readonly wallet: SidepanelWallet;
  /**
   * Repaints the shell. `reason` reaches the hydration pass: "action" forces a
   * balance refetch past the one-minute snapshot TTL, which is what a control
   * the user pressed has to do.
   */
  readonly render: (status: WalletStatus, reason?: RefreshReason) => Promise<void>;
  readonly setActiveView: (view: WalletView) => void;
  /** Overrides the confirmation checkpoints; tests pass a single zero delay. */
  readonly confirmationDelaysMs?: readonly number[];
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
        void render(status, "action");
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Lock failed"), "error", lockButton);
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
      await deps.render(status, "action");
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
 * What the deployment receipt says for each of the chain's answers. Exported so
 * UI Lab paints its receipt checkpoints from the copy the binder ships rather
 * than a restatement of it; display text only, it carries no authority.
 */
export const DEPLOY_RECEIPT_COPY = {
  confirmedDescription: "This account is on Starknet and can submit transactions.",
  confirmedTitle: "Account deployed",
  failedTitle: "Deployment failed",
  submittedTitle: "Deployment submitted",
} as const;

// A deployment has nothing to itemise, so its receipt states the outcome, says
// once what now exists, and shows the hash. The network comes off the live
// status rather than the markup, because the explorer link must match the chain
// the account was deployed on.
const paintDeployReceipt = async (
  deps: ShellBindingDeps,
  outcome: ConfirmationOutcome | null,
  hash: string,
): Promise<void> => {
  const status = await deps.wallet.loadStatus();
  if (!deps.app) return;
  paintOutcomeReceipt(
    deps.app,
    "deploy-success",
    outcomeReceiptFor(outcome, DEPLOY_RECEIPT_COPY, hash),
    status.networkId,
  );
};

/**
 * Binds the account-deployment action.
 *
 * The fee is part of the screen rather than a step before it: it is quoted as
 * soon as the screen opens, so Deploy is a decision the reader already has the
 * number for. The control used to say "Review deployment" and, on the first
 * press, turn into the confirm button — a label that promised a screen it never
 * opened.
 *
 * A quote that cannot be fetched does not strand the screen: the reason is
 * shown and Deploy quotes again on press, submitting once it has a figure.
 */
export const bindDeploy = (deps: ShellBindingDeps): void => {
  const button = deps.app?.querySelector<HTMLButtonElement>("#deploy-button");
  const reviewPanelRoot = deps.app?.querySelector<HTMLElement>("#deploy-review");
  const reviewStage = deps.app?.querySelector<HTMLElement>("#deploy-review-stage");
  const successStage = deps.app?.querySelector<HTMLElement>("#deploy-success");
  if (!button) {
    return;
  }
  const target = button;

  const showFee = (estimate: FeeEstimate): void => {
    DEPLOYMENT_FEES.set(target, estimate);
    if (reviewPanelRoot) {
      renderFragment(
        reviewPanelRoot,
        reviewCostNote(`Maximum network fee: ${formatFeeEstimate(estimate)}`),
      );
    }
  };

  // Only a failed quote belongs in the Cost box: it is why there is no fee.
  // A failed submission (RPC, nonce, revert) is not fee information, so it
  // empties the box (the spent quote is gone and Deploy quotes again) and is
  // reported on the status line and toast instead.
  const failed = (error: unknown, fallback: string, stage: "quote" | "submit"): void => {
    DEPLOYMENT_FEES.delete(target);
    const message = errorMessage(error, fallback);
    if (reviewPanelRoot) {
      renderFragment(reviewPanelRoot, stage === "quote" ? reviewCostNote(message) : "");
    }
    // A deployment whose reply was lost may be on chain: amber, not "failed".
    showToast(message, isOutcomeUnknown(error) ? "warning" : "error", target);
    scopedStatus(target, message);
    buttonBusy(target, false);
  };

  // Without a fee, the background quotes rather than deploys.
  const quote = (): void => {
    buttonBusy(target, true);
    scopedStatus(target, "Estimating fee…");
    void deps.wallet.deployAccount().then(
      (response) => {
        if (typeof response !== "string") showFee(response);
        scopedStatus(target, "");
        buttonBusy(target, false);
      },
      (error: unknown) => failed(error, "Could not estimate the deployment fee", "quote"),
    );
  };

  // Quoted once per mounted screen. The binder runs on every paint, and the
  // repaint that follows the quote would otherwise ask for another.
  if (!QUOTED_DEPLOYMENTS.has(target) && !target.disabled) {
    QUOTED_DEPLOYMENTS.add(target);
    quote();
  }

  if (deps.app) {
    bindOutcomeReceipt(deps.app, "deploy-success", {
      activity: () => deps.setActiveView("activity"),
      // A refused deployment changed nothing, so retrying is the screen it
      // started on, quoted afresh: the refused fee is not offered again.
      retry: () => {
        successStage?.setAttribute("hidden", "");
        reviewStage?.removeAttribute("hidden");
        if (reviewPanelRoot) renderFragment(reviewPanelRoot, "");
        quote();
      },
    });
  }
  target.addEventListener("click", () => {
    buttonBusy(target, true);
    scopedStatus(target, "Submitting deployment…");
    const reviewedFee = DEPLOYMENT_FEES.get(target);
    if (reviewedFee) DEPLOYMENT_FEES.delete(target);
    void deps.wallet.deployAccount(reviewedFee).then(
      async (response) => {
        // No quote was in hand, so this call returned one: show it and submit
        // on the next press rather than spending a fee the reader never saw.
        if (typeof response !== "string") {
          showFee(response);
          scopedStatus(target, "");
          buttonBusy(target, false);
          return;
        }
        reviewStage?.setAttribute("hidden", "");
        successStage?.removeAttribute("hidden");
        scopedStatus(target, "");
        buttonBusy(target, false);
        // Submitted is not deployed. The receipt says only what the chain has
        // answered for, so it opens on the submitted wording and turns into
        // the deployment or its failure once the chain answers.
        await paintDeployReceipt(deps, null, response);
        const outcome = await awaitConfirmation({
          ...(deps.confirmationDelaysMs ? { delaysMs: deps.confirmationDelaysMs } : {}),
          hash: response,
          loadActivity: () => deps.wallet.loadActivity(),
          stillCurrent: () => successStage?.isConnected === true,
        });
        if (successStage?.isConnected !== true) return;
        await paintDeployReceipt(deps, outcome, response);
        // As Send and Swap do, the toast is the chain's answer rather than the
        // handoff, which the receipt heading already states.
        if (outcome) {
          showToast(outcome.toast, outcome.kind === "succeeded" ? "success" : "error", target);
        }
      },
      // Without a quote in hand this press only asked for one.
      (error: unknown) => failed(error, "Deployment failed", reviewedFee ? "submit" : "quote"),
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
          showToast(errorMessage(error, "Network switch failed"), "error", button);
          if (result) {
            result.textContent = errorLine(error, "Network switch failed");
          }
          buttonBusy(button, false);
        },
      );
    });
  });
};
