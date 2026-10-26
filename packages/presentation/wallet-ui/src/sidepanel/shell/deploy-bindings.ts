/**
 * The account-deployment screen's binder and the post-deploy watchers, split
 * from `shell-bindings` (which re-exports them) to keep both within the file
 * budget. The fee is quoted when the screen opens; a sponsored deploy (#431),
 * when the background offers one, replaces the user's fee with the sponsor's
 * name rather than showing a fee nobody charges them.
 */
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { WalletStatus } from "../../popup/responses/responses";
import type { SidepanelWallet } from "../runtime/runtime";
import { isOutcomeUnknown } from "../runtime/runtime-errors";
import { awaitConfirmation, type ConfirmationOutcome } from "../shared/confirm-submitted";
import { buttonBusy, errorDetails, renderFragment, scopedStatus, showToast } from "../shared/dom";
import {
  bindOutcomeReceipt,
  outcomeReceiptFor,
  paintOutcomeReceipt,
} from "../shared/outcome-receipt";
import { formatFeeEstimate, reviewCostNote } from "../shared/review-render";
import { deployErrorLine, deployToastText } from "./deploy-errors";
import {
  type DeployJourney,
  deployJourney,
  firstDeployBinding,
  isCurrentDeployJourney,
  leaveDeployScreen,
} from "./deploy-journey";
import type { DeploymentPollScope, ShellBindingDeps } from "./shell-binding-deps";

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

// Shows the receipt of a deployment already sent and, until the chain has
// answered, waits for that answer on the screen as it is now. Submitted is not
// deployed: the receipt opens on the submitted wording and turns into the
// deployment or its failure once the chain answers. A repaint during the wait
// lands here again, so the wait carries on over the rebuilt screen; only the
// first answer is toasted.
const resumeDeployReceipt = (
  deps: ShellBindingDeps,
  journey: DeployJourney,
  reviewStage: HTMLElement | null | undefined,
  successStage: HTMLElement | null | undefined,
): void => {
  const receipt = journey.receipt;
  if (!receipt) return;
  reviewStage?.setAttribute("hidden", "");
  successStage?.removeAttribute("hidden");
  void paintDeployReceipt(deps, receipt.outcome, receipt.hash);
  if (receipt.settled) return;
  const live = (): boolean => successStage?.isConnected === true && journey.receipt === receipt;
  void awaitConfirmation({
    ...(deps.confirmationDelaysMs ? { delaysMs: deps.confirmationDelaysMs } : {}),
    hash: receipt.hash,
    loadActivity: () => deps.wallet.loadActivity(),
    stillCurrent: live,
  }).then(async (outcome) => {
    if (!live() || receipt.settled) return;
    receipt.outcome = outcome;
    receipt.settled = true;
    await paintDeployReceipt(deps, outcome, receipt.hash);
    // As Send and Swap do, the toast is the chain's answer rather than the
    // handoff, which the receipt heading already states.
    if (outcome && successStage) {
      showToast(outcome.toast, outcome.kind === "succeeded" ? "success" : "error", successStage);
    }
  });
};

// The background's refusal for an account it already reports deployed.
const ALREADY_DEPLOYED = "account already deployed";

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
  if (!button || !deps.app) {
    if (deps.app) leaveDeployScreen(deps.app);
    return;
  }
  const target = button;
  const app = deps.app;
  const journey = deployJourney(app, deps.deploymentScope?.() ?? null);
  // Binds the live screen again when an answer lands after a repaint rebuilt it.
  const rebind = (): void => {
    if (isCurrentDeployJourney(app, journey)) bindDeploy(deps);
  };

  const showFee = (estimate: FeeEstimate): void => {
    journey.fee = estimate;
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
  // A quote the screen asked for on its own is not toasted: the reader has not
  // done anything yet, and the Cost box already says why there is no fee.
  const failed = (
    error: unknown,
    fallback: string,
    stage: "quote" | "submit",
    toast = true,
  ): void => {
    delete journey.fee;
    // The reader's sentence, never the raw RPC dump (issue 662); the toast
    // keeps the raw diagnostic behind its copy control.
    const message = deployErrorLine(error, fallback);
    if (stage === "quote") journey.quoteNote = message;
    // A deployment whose reply was lost may be on chain: amber, not "failed".
    if (toast) {
      showToast(
        deployToastText(error, fallback),
        isOutcomeUnknown(error) ? "warning" : "error",
        target.isConnected ? target : app,
        errorDetails(error, fallback),
      );
    }
    // A quote that fails after a repaint is shown on the screen it rebuilt.
    if (stage === "quote" && !target.isConnected) {
      rebind();
      return;
    }
    if (reviewPanelRoot) {
      renderFragment(reviewPanelRoot, stage === "quote" ? reviewCostNote(message) : "");
    }
    scopedStatus(target, message);
    buttonBusy(target, false);
  };

  // Without a fee, the background quotes rather than deploys. The answer is
  // applied to the live screen, which a repaint while it was in flight rebuilt.
  const quote = (toast: boolean): void => {
    delete journey.quoteNote;
    buttonBusy(target, true);
    scopedStatus(target, "Estimating fee…");
    void deps.wallet.deployAccount().then(
      (response) => {
        if (typeof response !== "string") journey.fee = response;
        if (!target.isConnected) {
          rebind();
          return;
        }
        if (typeof response !== "string") showFee(response);
        scopedStatus(target, "");
        buttonBusy(target, false);
      },
      (error: unknown) => {
        // Deployed meanwhile (a send from this account deployed it): repaint
        // from a fresh read, which shows the deployed state (mc-wallet 712).
        if (error instanceof Error && error.message === ALREADY_DEPLOYED) {
          void deps.wallet.loadStatus().then((status) => deps.render(status, "action"));
        }
        failed(error, "Could not estimate the deployment fee", "quote", toast);
      },
    );
  };

  // Quoted once per visit. The binder runs on every paint; a repaint shows the
  // fee already in hand, or the receipt of a deployment already sent.
  if (journey.receipt) {
    resumeDeployReceipt(deps, journey, reviewStage, successStage);
  } else if (journey.pressed) {
    buttonBusy(target, true);
    scopedStatus(target, "Submitting deployment…");
  } else if (journey.fee) {
    showFee(journey.fee);
  } else if (journey.quoteNote !== undefined && reviewPanelRoot) {
    renderFragment(reviewPanelRoot, reviewCostNote(journey.quoteNote));
  } else if (!journey.quoted && !target.disabled) {
    journey.quoted = true;
    quote(false);
  }

  // A rebind paints the state above on a screen the repaint already bound.
  if (!firstDeployBinding(target)) return;
  if (deps.app) {
    bindOutcomeReceipt(deps.app, "deploy-success", {
      activity: () => deps.setActiveView("activity"),
      // A refused deployment changed nothing, so retrying is the screen it
      // started on, quoted afresh: the refused fee is not offered again.
      retry: () => {
        successStage?.setAttribute("hidden", "");
        reviewStage?.removeAttribute("hidden");
        if (reviewPanelRoot) renderFragment(reviewPanelRoot, "");
        delete journey.receipt;
        quote(true);
      },
    });
  }
  target.addEventListener("click", () => {
    if (journey.pressed) return;
    journey.pressed = true;
    buttonBusy(target, true);
    scopedStatus(target, "Submitting deployment…");
    const reviewedFee = journey.fee;
    delete journey.fee;
    // A repaint while the press is in flight rebuilt the screen; its answer is
    // applied there by binding the live screen again.
    const rebound = (): boolean => {
      if (target.isConnected) return false;
      rebind();
      return true;
    };
    void deps.wallet.deployAccount(reviewedFee).then(
      async (response) => {
        journey.pressed = false;
        // No quote was in hand, so this call returned one: show it and submit
        // on the next press rather than spending a fee the reader never saw.
        if (typeof response !== "string") {
          journey.fee = response;
          if (rebound()) return;
          showFee(response);
          scopedStatus(target, "");
          buttonBusy(target, false);
          return;
        }
        journey.receipt = { hash: response, outcome: null, settled: false };
        if (rebound()) return;
        scopedStatus(target, "");
        buttonBusy(target, false);
        resumeDeployReceipt(deps, journey, reviewStage, successStage);
      },
      // Without a quote in hand this press only asked for one.
      (error: unknown) => {
        journey.pressed = false;
        if (rebound()) {
          // Amber when the reply was lost: the deployment may be on chain.
          const tone = isOutcomeUnknown(error) ? "warning" : "error";
          showToast(
            deployToastText(error, "Deployment failed"),
            tone,
            deps.app,
            errorDetails(error, "Deployment failed"),
          );
          return;
        }
        failed(error, "Deployment failed", reviewedFee ? "submit" : "quote");
      },
    );
  });
};

