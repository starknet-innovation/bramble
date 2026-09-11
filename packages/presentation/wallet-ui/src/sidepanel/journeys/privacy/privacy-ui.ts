/**
 * Bindings for explicit private-balance disclosure and the staged
 * registration/shielding journey.
 */

import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import { accountDisplayName } from "../../shared/parts";
import type { SendIntent } from "../send/send-model";
import { applyPrivacyProgress, runActivation, showPreparing } from "./privacy-activation-run";
import { bindDeployAndRegister } from "./privacy-activation-ui";
import {
  captureScope,
  disclosureIsCurrent,
  loadPrivacyDisclosure,
  type PrivacyUiDeps,
  scopeKey,
  scopeMatches,
} from "./privacy-disclosure";
import {
  emptyPrivacyDisclosure,
  type PrivacyBlocker,
  type PrivacyJourneyState,
  privacyBlockerFor,
} from "./privacy-model";
import { createPendingRegistrationPoll } from "./privacy-pending-poll";
import type { PreparationProgress } from "./privacy-preparation-job";

/**
 * The privacy surface's collaborators, defined beside the disclosure loader
 * and re-exported here for the controller and the tests that bind this UI.
 */
export type { PrivacyUiDeps } from "./privacy-disclosure";

const defaultTokenId = (deps: PrivacyUiDeps): string | null =>
  deps.preferences()?.tokens.find((token) => token.networkId === deps.status().networkId)?.id ??
  null;

// The activation entry always leads somewhere. A prerequisite that is not met
// lands on the privacy screen with the reason and the next step, never on a
// toast that clears before it is read — that toast is what made the home
// Shield tile look dead.
const block = (
  deps: PrivacyUiDeps,
  tokenId: string,
  blocker: PrivacyBlocker,
  before: PrivacyJourneyState = deps.journey(),
): void => {
  const unchanged =
    before.stage === "blocked" &&
    before.blocker.kind === blocker.kind &&
    before.blocker.message === blocker.message;
  deps.setJourney({ blocker, stage: "blocked", tokenId });
  deps.navigate("privacy");
  // A retry from the blocked screen that meets the same answer repaints
  // nothing (an answer fast enough never shows the preparing screen in
  // between), so the answer is voiced as well or the retry looks ignored.
  if (unchanged) showToast(blocker.message, "error", deps.app);
};

// Shield and unshield are sends between one account's two balances, so both
// open Send already configured rather than a separate journey: the active
// account on both ends, and the buckets that name the direction. One builder
// for every entry — the asset screen's pair, the home tile, and the activation
// entry that finds registration already settled — so they cannot drift.
const openBucketSend = (
  deps: PrivacyUiDeps,
  tokenId: string,
  source: SendIntent["source"],
  destination: SendIntent["destination"],
): void => {
  const status = deps.status();
  const account = status.accounts.find((candidate) => candidate.id === status.activeAccountId);
  if (!account) return;
  deps.openSend?.({
    accountId: account.id,
    destination,
    networkId: account.networkId,
    recipient: account.address,
    recipientLabel: accountDisplayName(account, deps.preferences()),
    source,
    tokenId,
  });
};

// The entry point always leads somewhere, at once. Whatever it has to wait
// for — a discovery still in flight, a proof that takes minutes — is watched on
// the preparing screen, never behind a busy button: the tile dimming for a
// minute while a proof ran is exactly what was reported as "nothing happens".
const startJourney = async (deps: PrivacyUiDeps, tokenId: string): Promise<void> => {
  const scope = captureScope(deps);
  const before = deps.journey();
  if (!disclosureIsCurrent(deps)) {
    showPreparing(deps, tokenId, "discovering");
    // Joins a read already in flight rather than restarting it; the outcome is
    // only acted on while this screen is still the one being waited on.
    await loadPrivacyDisclosure(deps, { silent: true });
    const journey = deps.journey();
    if (
      !scopeMatches(deps, scope) ||
      journey.stage !== "preparing" ||
      journey.step !== "discovering"
    ) {
      return;
    }
  }
  const disclosure = deps.disclosure();
  if (!disclosure.value) {
    // Discovery failed or was superseded: a network without a pool, an
    // unreachable service, or a read still in flight. All three are explained
    // in place; the last offers the retry that a settled read would have made
    // unnecessary.
    block(
      deps,
      tokenId,
      privacyBlockerFor(
        disclosure.error ??
          (disclosure.loading
            ? "Private balances are still being discovered. Try again in a moment."
            : "Private balances unavailable"),
      ),
      before,
    );
    return;
  }
  const state = disclosure.value;
  if (state.registration === "pending") {
    // Registered on Starknet, not yet visible to the indexer. The poll flips
    // this on its own, so the only wrong move here is preparing a second one.
    block(
      deps,
      tokenId,
      {
        kind: "pending",
        message: "Registration is on its way. You'll be able to shield shortly.",
      },
      before,
    );
    return;
  }
  if (state.registration === "registered") {
    // The surface offered activation on a reading that has since settled:
    // there is nothing to activate, so this is the shield shortcut itself. The
    // journey has nothing left to show, so a wait screen it went through is
    // not left behind as the privacy view's content.
    deps.setJourney({ stage: "idle" });
    openBucketSend(deps, tokenId, "public", "private");
    return;
  }
  runActivation(deps, tokenId, (watched, blocker) => block(deps, watched, blocker, before));
};

// One poll for the whole surface: any view that binds privacy while a
// registration is pending keeps the reading fresh until it settles, so the flip
// to "registered" needs no user action on any screen.
const pendingPoll = createPendingRegistrationPoll();

const syncPendingPoll = (deps: PrivacyUiDeps): void => {
  const scope = captureScope(deps);
  pendingPoll.sync(deps.disclosure().value?.registration === "pending", {
    apply: (value) => {
      deps.setDisclosure({ error: null, loading: false, value });
      deps.paint();
    },
    load: () => deps.wallet.loadPrivacyState(),
    scopeKey: scopeKey(scope),
    stillCurrent: (value) =>
      scopeMatches(deps, scope) &&
      value.accountId === scope.accountId &&
      value.networkId === scope.networkId,
    visible: () => deps.app?.ownerDocument.visibilityState === "visible",
  });
};

const bindDisclosure = (deps: PrivacyUiDeps): void => {
  // Balances are unified: discovery starts automatically for the unlocked
  // active account. `error` intentionally blocks re-triggering so a failing
  // service is retried only through the explicit retry affordance.
  const status = deps.status();
  const disclosure = deps.disclosure();
  if (
    status.ready &&
    !status.locked &&
    status.activeAccountId !== null &&
    !disclosure.loading &&
    !disclosure.error &&
    disclosure.value === null
  ) {
    void loadPrivacyDisclosure(deps);
  }
  syncPendingPoll(deps);
  // Deploy-then-register lands on the same journey as the plain entry, so both
  // reach the identical review.
  bindDeployAndRegister({
    app: deps.app,
    deploymentScope: () => {
      const scope = captureScope(deps);
      return scope.accountId === null
        ? null
        : {
            accountId: scope.accountId,
            stillCurrent: () => scopeMatches(deps, scope),
          };
    },
    startRegistration: () => {
      const tokenId = defaultTokenId(deps);
      if (tokenId) {
        void startJourney(deps, tokenId);
      }
    },
    wallet: deps.wallet,
  });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-privacy-retry]").forEach((button) => {
    button.addEventListener("click", () => {
      buttonBusy(button, true);
      void loadPrivacyDisclosure(deps).finally(() => buttonBusy(button, false));
    });
  });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-privacy-register]").forEach((button) => {
    button.addEventListener("click", () => {
      const tokenId = button.dataset["privacyRegister"] || defaultTokenId(deps);
      if (tokenId) {
        void startJourney(deps, tokenId);
      }
    });
  });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-privacy-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const tokenId = button.dataset["privacyOpen"];
      if (tokenId) {
        void startJourney(deps, tokenId);
      }
    });
  });
  bindShieldShortcuts(deps);
};

const bindShieldShortcuts = (deps: PrivacyUiDeps): void => {
  for (const [attribute, key, source, destination] of [
    ["data-send-shield", "sendShield", "public", "private"],
    ["data-send-unshield", "sendUnshield", "private", "public"],
  ] as const) {
    deps.app?.querySelectorAll<HTMLButtonElement>(`[${attribute}]`).forEach((button) => {
      button.addEventListener("click", () => {
        const tokenId = button.dataset[key];
        if (tokenId) openBucketSend(deps, tokenId, source, destination);
      });
    });
  }
};

const bindConfirmation = (
  deps: PrivacyUiDeps,
  journey: Extract<PrivacyJourneyState, { readonly stage: "activate-review" }>,
): void => {
  const button = deps.app?.querySelector<HTMLButtonElement>("#privacy-confirm");
  button?.addEventListener("click", () => {
    // Registration is the only operation left on this surface: every movement of
    // value — shield, unshield, private send — runs through the Send flow.
    if (journey.preparation.kind !== "register") {
      return;
    }
    const kind = "register" as const;
    const scope = captureScope(deps);
    deps.setJourney({
      kind,
      preparation: journey.preparation,
      stage: "working",
      tokenId: journey.tokenId,
    });
    deps.paint();
    const onProgress = (progress: PreparationProgress): void => {
      const current = deps.journey();
      if (!scopeMatches(deps, scope) || current.stage !== "working") return;
      deps.setJourney({ ...current, progress });
      applyPrivacyProgress(deps.app, progress);
    };
    void deps.wallet.executePrivacyPreparation(journey.preparation.id, onProgress).then(
      (hash) => {
        if (!scopeMatches(deps, scope)) {
          return;
        }
        deps.setJourney({
          hash,
          kind,
          stage: "success",
          symbol: journey.preparation.symbol,
          tokenId: journey.tokenId,
        });
        // The cached reading is now provably stale: registration just changed,
        // or balance moved between the public and private sides. Dropping it
        // makes the next paint re-read through the normal auto-discovery path,
        // so the home rows show the settled state without the user hunting for
        // a refresh control.
        deps.setDisclosure(emptyPrivacyDisclosure());
        deps.paint();
      },
      (error: unknown) => {
        if (!scopeMatches(deps, scope)) {
          return;
        }
        deps.setJourney({
          error: errorMessage(error, "Private transaction failed"),
          stage: "failure",
          tokenId: journey.tokenId,
        });
        deps.paint();
      },
    );
  });
};

const bindOutcome = (deps: PrivacyUiDeps, journey: PrivacyJourneyState): void => {
  if (journey.stage === "preparing") {
    // Leaving the wait: the outcome is dropped when it lands, and a proof still
    // running keeps its slot so pressing the entry again rejoins it.
    deps.app?.querySelector("#privacy-cancel")?.addEventListener("click", () => {
      deps.setJourney({ stage: "idle" });
      deps.navigate("home");
    });
  }
  if (journey.stage === "success") {
    deps.app?.querySelector("#privacy-done")?.addEventListener("click", () => {
      deps.navigate("home");
    });
  }
  if (journey.stage === "failure" || journey.stage === "blocked") {
    deps.app?.querySelector("#privacy-retry")?.addEventListener("click", () => {
      void startJourney(deps, journey.tokenId);
    });
    deps.app?.querySelector("#privacy-cancel")?.addEventListener("click", () => {
      deps.navigate("home");
    });
  }
};

/**
 * Binds every privacy control present in the current render.
 */
export const bindPrivacy = (deps: PrivacyUiDeps): void => {
  bindDisclosure(deps);
  const journey = deps.journey();
  if (journey.stage === "activate-review") {
    bindConfirmation(deps, journey);
  } else {
    bindOutcome(deps, journey);
  }
};
