/**
 * The activation proof as the panel watches it.
 *
 * Preparing a registration is a tracked background job that can take minutes
 * (discovery, pool maturity, remote proving, fee estimate). The entry point
 * hands off here the moment it knows the account is unregistered: the journey
 * moves to its `preparing` screen at once, every poll of the job rewrites that
 * screen's liveness line in place, and the outcome — the review, or the
 * prerequisite that stopped it — replaces the screen when it lands.
 *
 * One run per account scope. A second press while the proof runs re-attaches
 * to the same job instead of starting another: a duplicate proof is a minute
 * of wasted work whose first result is discarded, and repeated presses are
 * exactly what a wait with no feedback provokes. Backing out is safe — nothing
 * is signed or sent before the review is confirmed, and an abandoned
 * preparation is never executed — so leaving the screen only drops the
 * outcome; the job keeps its slot until it settles, so coming back rejoins it.
 */

import { captureScope, type PrivacyUiDeps, scopeKey, scopeMatches } from "./privacy-disclosure";
import {
  type PrivacyBlocker,
  type PrivacyJourneyState,
  type PrivacyPreparingStep,
  privacyBlockerFor,
} from "./privacy-model";
import type { PreparationProgress } from "./privacy-preparation-job";
import { privacyLivenessText } from "./privacy-views";

type ActivationRun = {
  readonly key: string;
  progress: PreparationProgress | null;
};

let activationRun: ActivationRun | null = null;

const isProving = (
  journey: PrivacyJourneyState,
): journey is Extract<PrivacyJourneyState, { readonly stage: "preparing" }> =>
  journey.stage === "preparing" && journey.step === "proving";

/**
 * Rewrites only the preparing screen's liveness line for a progress poll, so a
 * job that reports every second and a half does not repaint the whole screen.
 * A full repaint renders the same line from the journey state.
 */
export const applyPrivacyProgress = (
  app: Element | null,
  progress: PreparationProgress | null,
): void => {
  const line = app?.querySelector("#privacy-liveness");
  if (line) {
    line.textContent = privacyLivenessText(progress);
  }
};

/**
 * Moves the journey onto the preparing screen for `step` and shows it. The
 * navigation is what makes the press visible immediately; the paint happens
 * inside it.
 */
export const showPreparing = (
  deps: PrivacyUiDeps,
  tokenId: string,
  step: PrivacyPreparingStep,
  progress: PreparationProgress | null = null,
): void => {
  deps.setJourney({ progress, stage: "preparing", step, tokenId });
  deps.navigate("privacy");
};

/**
 * Starts the activation proof for the active account, or rejoins the one
 * already running for it, and shows the preparing screen either way. `onBlocked`
 * receives the prerequisite that stopped the proof so the caller lands it on the
 * explained screen it owns.
 */
export const runActivation = (
  deps: PrivacyUiDeps,
  tokenId: string,
  onBlocked: (tokenId: string, blocker: PrivacyBlocker) => void,
): void => {
  const scope = captureScope(deps);
  const key = scopeKey(scope);
  if (activationRun?.key === key) {
    showPreparing(deps, tokenId, "proving", activationRun.progress);
    return;
  }
  const run: ActivationRun = { key, progress: null };
  activationRun = run;
  showPreparing(deps, tokenId, "proving");
  const onProgress = (progress: PreparationProgress): void => {
    run.progress = progress;
    const journey = deps.journey();
    if (activationRun !== run || !scopeMatches(deps, scope) || !isProving(journey)) {
      return;
    }
    deps.setJourney({ ...journey, progress });
    applyPrivacyProgress(deps.app, progress);
  };
  // The outcome is applied only while the user is still waiting on this run:
  // the journey is the proving screen (watched, or left by the header's back
  // with the wait still owned) and the scope it was started in is still active.
  // The token is the screen's, not the starter's: a rejoin from another asset's
  // entry lands its review under that asset.
  const settled = (): string | null => {
    if (activationRun === run) activationRun = null;
    const journey = deps.journey();
    return scopeMatches(deps, scope) && isProving(journey) ? journey.tokenId : null;
  };
  void deps.wallet.preparePrivacyRegistration(onProgress).then(
    (preparation) => {
      const watched = settled();
      if (watched === null) return;
      deps.setJourney({ preparation, stage: "activate-review", tokenId: watched });
      deps.navigate("privacy");
    },
    (error: unknown) => {
      const watched = settled();
      if (watched === null) return;
      const blocker = privacyBlockerFor(error);
      onBlocked(watched, {
        kind: blocker.kind,
        message: blocker.message,
      });
    },
  );
};
