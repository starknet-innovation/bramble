/**
 * Bindings for explicit private-balance disclosure and the staged
 * registration/shielding journey.
 */

import type { TokenBalance, WalletStatus } from "../popup/responses";
import { formatTokenAmount } from "../starknet/rpc";
import type { WalletPreferences } from "../storage/preferences-store";
import { buttonBusy, errorMessage, showToast } from "./dom";
import type { PrivacyDisclosureState, PrivacyJourneyState } from "./privacy-model";
import type { SidepanelWallet } from "./runtime";

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
  readonly openToken: (tokenId: string) => void;
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

const loadDisclosure = async (deps: PrivacyUiDeps): Promise<boolean> => {
  const scope = captureScope(deps);
  const pending: PrivacyDisclosureState = {
    enabled: true,
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
    deps.setDisclosure({ enabled: true, error: null, loading: false, value });
    deps.paint();
    return true;
  } catch (error) {
    if (deps.disclosure() === pending && scopeMatches(deps, scope)) {
      deps.setDisclosure({
        enabled: true,
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
      : await loadDisclosure(deps);
  const state = deps.disclosure().value;
  if (!ready || !state || !scopeMatches(deps, scope)) {
    buttonBusy(button, false);
    return;
  }
  try {
    if (state.registration === "unregistered") {
      const preparation = await deps.wallet.preparePrivacyRegistration();
      if (!scopeMatches(deps, scope)) {
        return;
      }
      deps.setJourney({ preparation, stage: "activate-review", tokenId });
    } else {
      deps.setJourney({ stage: "compose", tokenId });
    }
    deps.navigate("privacy");
  } catch (error) {
    showToast(errorMessage(error, "Private journey unavailable"), "error");
    buttonBusy(button, false);
  }
};

const bindDisclosure = (deps: PrivacyUiDeps): void => {
  const toggle = deps.app?.querySelector<HTMLInputElement>("[data-privacy-toggle]");
  toggle?.addEventListener("change", () => {
    if (!toggle.checked) {
      deps.setDisclosure({ enabled: false, error: null, loading: false, value: null });
      deps.paint();
      return;
    }
    void loadDisclosure(deps);
  });
  deps.app
    ?.querySelector<HTMLButtonElement>("[data-privacy-retry]")
    ?.addEventListener("click", () => {
      void loadDisclosure(deps);
    });
  deps.app
    ?.querySelector<HTMLButtonElement>("[data-privacy-register]")
    ?.addEventListener("click", (event) => {
      const tokenId = defaultTokenId(deps);
      if (tokenId) {
        void startJourney(deps, tokenId, event.currentTarget as HTMLButtonElement);
      }
    });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-privacy-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const tokenId = button.dataset["privacyOpen"];
      if (tokenId) {
        void startJourney(deps, tokenId, button);
      }
    });
  });
};

const bindAmountShortcuts = (deps: PrivacyUiDeps, tokenId: string): void => {
  const input = deps.app?.querySelector<HTMLInputElement>("#privacy-amount");
  const balance = deps.balances().find((candidate) => candidate.id === tokenId);
  const token = deps.preferences()?.tokens.find((candidate) => candidate.id === tokenId);
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-privacy-amount]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!input || !balance || !token) {
        return;
      }
      if (button.dataset["privacyAmount"] === "max") {
        input.value = balance.formatted;
        return;
      }
      input.value = formatTokenAmount(BigInt(balance.balance) / 2n, token.decimals);
    });
  });
};

const bindCompose = (deps: PrivacyUiDeps, tokenId: string): void => {
  bindAmountShortcuts(deps, tokenId);
  const form = deps.app?.querySelector<HTMLFormElement>("#privacy-deposit-form");
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const result = deps.app?.querySelector<HTMLElement>("#privacy-compose-result");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = String(new FormData(form).get("amount") ?? "").trim();
    const scope = captureScope(deps);
    buttonBusy(submit, true);
    void deps.wallet.preparePrivacyDeposit(tokenId, amount).then(
      (preparation) => {
        if (!scopeMatches(deps, scope)) {
          return;
        }
        deps.setJourney({ preparation, stage: "deposit-review", tokenId });
        deps.paint();
      },
      (error: unknown) => {
        if (!scopeMatches(deps, scope)) {
          return;
        }
        const message = errorMessage(error, "Shielding preparation failed");
        if (result) {
          result.textContent = message;
        }
        showToast(message, "error");
        buttonBusy(submit, false);
      },
    );
  });
};

const bindConfirmation = (
  deps: PrivacyUiDeps,
  journey: Extract<PrivacyJourneyState, { readonly stage: "activate-review" | "deposit-review" }>,
): void => {
  const button = deps.app?.querySelector<HTMLButtonElement>("#privacy-confirm");
  button?.addEventListener("click", () => {
    const scope = captureScope(deps);
    deps.setJourney({
      kind: journey.preparation.kind,
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
          kind: journey.preparation.kind,
          stage: "success",
          symbol: journey.preparation.symbol,
          tokenId: journey.tokenId,
        });
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
    deps.app?.querySelector("#privacy-check-activation")?.addEventListener("click", () => {
      deps.setDisclosure({ enabled: true, error: null, loading: false, value: null });
      const scope = captureScope(deps);
      void loadDisclosure(deps).then((loaded) => {
        if (!loaded || !scopeMatches(deps, scope)) {
          return;
        }
        if (deps.disclosure().value?.registration !== "registered") {
          showToast(
            "Activation is accepted but still being indexed. Check again shortly.",
            "error",
          );
          return;
        }
        deps.setJourney({ stage: "compose", tokenId: journey.tokenId });
        deps.navigate("privacy");
      });
    });
    deps.app?.querySelector("#privacy-check-balance")?.addEventListener("click", () => {
      deps.setDisclosure({ enabled: true, error: null, loading: false, value: null });
      const scope = captureScope(deps);
      void loadDisclosure(deps).then((loaded) => {
        if (loaded && scopeMatches(deps, scope)) {
          deps.navigate("home");
        }
      });
    });
    deps.app?.querySelector("#privacy-done")?.addEventListener("click", () => {
      deps.openToken(journey.tokenId);
    });
  }
  if (journey.stage === "failure") {
    deps.app?.querySelector("#privacy-retry")?.addEventListener("click", () => {
      void startJourney(deps, journey.tokenId);
    });
    deps.app?.querySelector("#privacy-cancel")?.addEventListener("click", () => {
      deps.openToken(journey.tokenId);
    });
  }
};

/**
 * Binds every privacy control present in the current render.
 */
export const bindPrivacy = (deps: PrivacyUiDeps): void => {
  bindDisclosure(deps);
  const journey = deps.journey();
  if (journey.stage === "compose") {
    bindCompose(deps, journey.tokenId);
  } else if (journey.stage === "activate-review" || journey.stage === "deposit-review") {
    bindConfirmation(deps, journey);
  } else {
    bindOutcome(deps, journey);
  }
};
