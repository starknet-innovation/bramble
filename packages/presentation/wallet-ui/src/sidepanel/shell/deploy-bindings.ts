/**
 * The account-deployment screen's binder, split from `shell-bindings` (which
 * re-exports it) to keep both within the file budget; the post-deploy watchers
 * live in `deployment-watch`. The fee is quoted when the screen opens; a sponsored deploy (issue 431),
 * when the background offers one, replaces the user's fee with the sponsor's
 * name rather than showing a fee nobody charges them.
 */

import { DEPLOYMENT_IN_PROGRESS } from "@bramble/privacy/sponsored-deploy";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import { isOutcomeUnknown } from "../runtime/runtime-errors";
import type { ConfirmationOutcome } from "../shared/confirm-submitted";
import { buttonBusy, errorDetails, renderFragment, scopedStatus, showToast } from "../shared/dom";
import {
  bindOutcomeReceipt,
  outcomeReceiptFor,
  paintOutcomeReceipt,
} from "../shared/outcome-receipt";
import { reviewCostNote } from "../shared/review-render";
import { platformTimers } from "../shared/stage-pacer";
import { deployErrorLine, deployToastText } from "./deploy-errors";
import {
  type DeployJourney,
  deployJourney,
  firstDeployBinding,
  isCurrentDeployJourney,
  leaveDeployScreen,
  scheduleDeployHold,
  stopDeployHold,
} from "./deploy-journey";
import { awaitDeployOutcome } from "./deploy-receipt-watch";
import { deployCostLine, paintDeployHold } from "./deploy-sponsorship";
import type { ShellBindingDeps } from "./shell-binding-deps";

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
  void awaitDeployOutcome({
    accountId: journey.accountId,
    ...(deps.confirmationDelaysMs ? { delaysMs: deps.confirmationDelaysMs } : {}),
    hash: receipt.hash,
    sponsored: receipt.sponsored,
    stillCurrent: live,
    wallet: deps.wallet,
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
        reviewCostNote(deployCostLine(estimate, journey.sponsorship)),
      );
    }
  };

  const live = (): boolean => isCurrentDeployJourney(app, journey) && journey.stillCurrent();
  const holdTimer = deps.deployHoldTimers ?? platformTimers;

  // While an earlier sponsored attempt's hold stands the screen is deploying,
  // and it re-checks on its own: the chain showing the account deployed
  // repaints it deployed, and the hold ending brings back the plain self-paid
  // screen, quoted afresh. Leaving, locking or switching stops the re-check.
  // A read that fails keeps the screen re-checking rather than stranding it.
  const holdRecheck = (current: () => boolean): void => {
    const again = (): void => {
      if (current()) scheduleDeployHold(journey, holdTimer, live, holdRecheck);
    };
    void (async () => {
      const sponsorship = await deps.wallet.deploySponsorship();
      if (!current()) return;
      if (sponsorship === "held") {
        again();
        return;
      }
      const deployment = await deps.wallet.loadDeploymentStatus().catch(() => null);
      if (!current()) return;
      if (deployment?.deployed && deployment.accountId === journey.accountId) {
        const status = await deps.wallet.loadStatus().catch(() => null);
        if (!current()) return;
        if (status === null) {
          again();
          return;
        }
        stopDeployHold(journey);
        // A repaint that fails leaves this screen up: keep re-checking it.
        await deps.render(status, "action").catch(() => {
          if (live()) scheduleDeployHold(journey, holdTimer, live, holdRecheck);
        });
        return;
      }
      stopDeployHold(journey);
      journey.sponsorship = "none";
      journey.quoted = false;
      if (!target.isConnected) {
        rebind();
        return;
      }
      paintDeployHold(target, reviewStage, reviewPanelRoot, false);
      journey.quoted = true;
      quote(false);
    })().catch(again);
  };
  const enterHold = (): void => {
    journey.sponsorship = "held";
    delete journey.fee;
    if (target.isConnected) paintDeployHold(target, reviewStage, reviewPanelRoot, true);
    else rebind();
    scheduleDeployHold(journey, holdTimer, live, holdRecheck);
  };

  // Asks after the fee is in hand whether the sponsor will pay, once per visit.
  // A press made before the answer lands deploys as the screen showed it then.
  const askSponsorship = (): void => {
    if (journey.sponsorship !== undefined) return;
    journey.sponsorship = "none";
    // A wallet double without the sponsored route offers nothing.
    if (typeof deps.wallet.deploySponsorship !== "function") return;
    void deps.wallet.deploySponsorship().then((sponsorship) => {
      if (!isCurrentDeployJourney(app, journey) || journey.pressed || journey.receipt) return;
      if (sponsorship === "held") {
        enterHold();
        return;
      }
      journey.sponsorship = sponsorship;
      if (!journey.fee) return;
      if (target.isConnected) showFee(journey.fee);
      else rebind();
    });
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
        if (typeof response !== "string") {
          showFee(response);
          askSponsorship();
        }
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
  } else if (journey.sponsorship === "held") {
    paintDeployHold(target, reviewStage, reviewPanelRoot, true);
    scheduleDeployHold(journey, holdTimer, live, holdRecheck);
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
        // A failed sponsored deploy is never re-offered; the background says so.
        delete journey.sponsorship;
        stopDeployHold(journey);
        quote(true);
      },
    });
  }
  // A repaint while a press is in flight rebuilt the screen; its answer is
  // applied there by binding the live screen again.
  const rebound = (): boolean => {
    if (target.isConnected) return false;
    rebind();
    return true;
  };
  const showReceipt = (hash: string, sponsored: boolean): void => {
    journey.receipt = { hash, outcome: null, settled: false, sponsored };
    if (rebound()) return;
    scopedStatus(target, "");
    buttonBusy(target, false);
    resumeDeployReceipt(deps, journey, reviewStage, successStage);
  };

  // The sponsor pays: nothing is signed and no fee is the user's. When the
  // sponsor is not deploying it (nothing was sent), the screen silently becomes
  // the self-paid one. A lost reply, or a hold already standing, shows the
  // account deploying until the background's hold resolves.
  const deploySponsored = (): void => {
    void deps.wallet.deployAccountSponsored().then(
      (hash) => {
        journey.pressed = false;
        if (hash !== null) {
          showReceipt(hash, true);
          return;
        }
        journey.sponsorship = "none";
        if (!journey.fee) journey.quoted = false;
        if (rebound()) return;
        scopedStatus(target, "");
        buttonBusy(target, false);
        if (journey.fee) {
          showFee(journey.fee);
          return;
        }
        journey.quoted = true;
        quote(false);
      },
      (error: unknown) => {
        journey.pressed = false;
        const message = error instanceof Error ? error.message : "";
        if (isOutcomeUnknown(error) || message === DEPLOYMENT_IN_PROGRESS) {
          enterHold();
          return;
        }
        if (message === ALREADY_DEPLOYED) {
          void deps.wallet.loadStatus().then((status) => deps.render(status, "action"));
        }
        if (rebound()) {
          showToast(
            deployToastText(error, "Deployment failed"),
            "error",
            app,
            errorDetails(error, "Deployment failed"),
          );
          return;
        }
        failed(error, "Deployment failed", "submit");
      },
    );
  };

  target.addEventListener("click", () => {
    if (journey.pressed) return;
    journey.pressed = true;
    buttonBusy(target, true);
    scopedStatus(target, "Submitting deployment…");
    if (journey.sponsorship === "available") {
      deploySponsored();
      return;
    }
    const reviewedFee = journey.fee;
    delete journey.fee;
    void deps.wallet.deployAccount(reviewedFee).then(
      async (response) => {
        journey.pressed = false;
        // No quote was in hand, so this call returned one: show it and submit
        // on the next press rather than spending a fee the reader never saw.
        if (typeof response !== "string") {
          journey.fee = response;
          if (rebound()) return;
          showFee(response);
          askSponsorship();
          scopedStatus(target, "");
          buttonBusy(target, false);
          return;
        }
        showReceipt(response, false);
      },
      // Without a quote in hand this press only asked for one.
      (error: unknown) => {
        journey.pressed = false;
        // A sponsored attempt's hold refused it before anything was signed.
        if (error instanceof Error && error.message === DEPLOYMENT_IN_PROGRESS) {
          enterHold();
          return;
        }
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
