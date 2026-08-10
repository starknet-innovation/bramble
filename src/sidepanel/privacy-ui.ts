/**
 * Bindings for explicit private-balance disclosure and the staged
 * registration/shielding journey.
 */

import type { TokenBalance, WalletStatus } from "../popup/responses";
import type { WalletPreferences } from "../storage/preferences-store";
import { buttonBusy, errorMessage, showToast } from "./dom";
import { accountDisplayName } from "./parts";
import { bindDeployAndRegister } from "./privacy-activation-ui";
import {
  emptyPrivacyDisclosure,
  type PrivacyDisclosureState,
  type PrivacyJourneyState,
} from "./privacy-model";
import { createPendingRegistrationPoll } from "./privacy-pending-poll";
import type { SidepanelWallet } from "./runtime";
import type { SendIntent } from "./send-model";

/**
 * Current render state and callbacks consumed by privacy bindings.
 */
export type PrivacyUiDeps = {
  readonly app: Element | null;
  readonly balances: () => readonly TokenBalance[];
  readonly disclosure: () => PrivacyDisclosureState;
  readonly generation: () => number;
  readonly journey: () => PrivacyJourneyState;
  readonly navigate: (view: "activity" | "home" | "privacy" | "token-detail") => void;
  /** Opens Send pre-configured for a shield or unshield shortcut. */
  readonly openSend?: (intent: SendIntent) => void;
  readonly paint: () => void;
  readonly preferences: () => WalletPreferences | null;
  readonly setDisclosure: (state: PrivacyDisclosureState) => void;
  readonly setJourney: (state: PrivacyJourneyState) => void;
  readonly status: () => WalletStatus;
  readonly wallet: SidepanelWallet;
};

type PrivacyAsyncScope = {
  readonly accountId: string | null;
  readonly generation: number;
  readonly networkId: string;
};

const captureScope = (deps: PrivacyUiDeps): PrivacyAsyncScope => {
  const status = deps.status();
  return {
    accountId: status.activeAccountId,
    generation: deps.generation(),
    networkId: status.networkId,
  };
};

const scopeMatches = (deps: PrivacyUiDeps, scope: PrivacyAsyncScope): boolean => {
  const status = deps.status();
  return (
    deps.generation() === scope.generation &&
    status.activeAccountId === scope.accountId &&
    status.networkId === scope.networkId
  );
};

/**
 * Re-reads the active account's privacy state with account/network staleness
 * guards. Exported so Send's recoverable route error uses the same loader and
 * never grows a second disclosure path.
 */
export const loadPrivacyDisclosure = async (deps: PrivacyUiDeps): Promise<boolean> => {
  const scope = captureScope(deps);
  const pending: PrivacyDisclosureState = {
    error: null,
    loading: true,
    value: null,
  };
  deps.setDisclosure(pending);
  deps.paint();
  try {
    const value = await deps.wallet.loadPrivacyState();
    if (
      deps.disclosure() !== pending ||
      !scopeMatches(deps, scope) ||
      value.accountId !== scope.accountId ||
      value.networkId !== scope.networkId
    ) {
      return false;
    }
    deps.setDisclosure({ error: null, loading: false, value });
    deps.paint();
    return true;
  } catch (error) {
    if (deps.disclosure() === pending && scopeMatches(deps, scope)) {
      deps.setDisclosure({
        error: errorMessage(error, "Private balances unavailable"),
        loading: false,
        value: null,
      });
      deps.paint();
    }
    return false;
  }
};

const defaultTokenId = (deps: PrivacyUiDeps): string | null =>
  deps.preferences()?.tokens.find((token) => token.networkId === deps.status().networkId)?.id ??
  null;

const startJourney = async (
  deps: PrivacyUiDeps,
  tokenId: string,
  button?: HTMLButtonElement,
): Promise<void> => {
  const scope = captureScope(deps);
  buttonBusy(button, true);
  const current = deps.disclosure();
  const ready =
    current.value?.accountId === deps.status().activeAccountId &&
    current.value.networkId === deps.status().networkId
      ? true
      : await loadPrivacyDisclosure(deps);
  const state = deps.disclosure().value;
  if (!ready || !state || !scopeMatches(deps, scope)) {
    buttonBusy(button, false);
    return;
  }
  try {
    if (state.registration === "pending") {
      // Registered on Starknet, not yet visible to the indexer. The poll flips
      // this on its own, so the only wrong move here is preparing a second one.
      showToast("Registration is on its way. You'll be able to shield shortly.", "success");
      buttonBusy(button, false);
      return;
    }
    if (state.registration !== "unregistered") {
      // Nothing to do: an activated account shields and unshields from Send, and
      // no surface offers this entry once registration has settled.
      buttonBusy(button, false);
      return;
    }
    const preparation = await deps.wallet.preparePrivacyRegistration();
    if (!scopeMatches(deps, scope)) {
      return;
    }
    deps.setJourney({ preparation, stage: "activate-review", tokenId });
    deps.navigate("privacy");
  } catch (error) {
    showToast(errorMessage(error, "Private journey unavailable"), "error");
    buttonBusy(button, false);
  }
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
    scopeKey: `${scope.networkId}:${scope.accountId ?? ""}:${scope.generation}`,
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
  deps.app
    ?.querySelector<HTMLButtonElement>("[data-privacy-retry]")
    ?.addEventListener("click", () => {
      void loadPrivacyDisclosure(deps);
    });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-privacy-register]").forEach((button) => {
    button.addEventListener("click", () => {
      const tokenId = button.dataset["privacyRegister"] || defaultTokenId(deps);
      if (tokenId) {
        void startJourney(deps, tokenId, button);
      }
    });
  });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-privacy-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const tokenId = button.dataset["privacyOpen"];
      if (tokenId) {
        void startJourney(deps, tokenId, button);
      }
    });
  });
  bindShieldShortcuts(deps);
};

// Shield and unshield are sends between one account's two balances, so both
// shortcuts open Send already configured rather than a separate journey: the
// active account on both ends, and the buckets that name the direction.
const bindShieldShortcuts = (deps: PrivacyUiDeps): void => {
  const account = deps
    .status()
    .accounts.find((candidate) => candidate.id === deps.status().activeAccountId);
  for (const [attribute, key, source, destination] of [
    ["data-send-shield", "sendShield", "public", "private"],
    ["data-send-unshield", "sendUnshield", "private", "public"],
  ] as const) {
    deps.app?.querySelectorAll<HTMLButtonElement>(`[${attribute}]`).forEach((button) => {
      button.addEventListener("click", () => {
        const tokenId = button.dataset[key];
        if (!tokenId || !account) {
          return;
        }
        deps.openSend?.({
          destination,
          recipient: account.address,
          recipientLabel: accountDisplayName(account, deps.preferences()),
          source,
          tokenId,
        });
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
    void deps.wallet.executePrivacyPreparation(journey.preparation.id).then(
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
  if (journey.stage === "success") {
    deps.app?.querySelector("#privacy-done")?.addEventListener("click", () => {
      deps.navigate("home");
    });
  }
  if (journey.stage === "failure") {
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
