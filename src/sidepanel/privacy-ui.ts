/**
 * Bindings for explicit private-balance disclosure and the staged
 * registration/shielding journey.
 */

import type { TokenBalance, WalletStatus } from "../popup/responses";
import { STRK_TOKEN_ADDRESS, sameFelt } from "../starknet/networks";
import type { WalletPreferences } from "../storage/preferences-store";
import { buttonBusy, errorMessage, showToast } from "./dom";
import type { PrivacyDisclosureState, PrivacyJourneyState } from "./privacy-model";
import { maxPrivacyMove, projectPrivacyMove } from "./privacy-projection";
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
    void loadDisclosure(deps);
  }
  deps.app
    ?.querySelector<HTMLButtonElement>("[data-privacy-retry]")
    ?.addEventListener("click", () => {
      void loadDisclosure(deps);
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
};

// Reads the compose card's current direction-dependent numbers.
const composeContext = (form: HTMLFormElement, tokenAddress: string) => {
  const unshielding = form.dataset["direction"] === "unshield";
  return {
    decimals: Number(form.dataset["decimals"] ?? "18"),
    feeInSameToken: sameFelt(tokenAddress, STRK_TOKEN_ADDRESS),
    poolFeeFri: form.dataset["poolFee"],
    sourceBalanceRaw: unshielding
      ? (form.dataset["privateBalanceRaw"] ?? "0")
      : (form.dataset["publicBalance"] ?? "0"),
    symbol: form.dataset["symbol"] ?? "",
    unshielding,
  };
};

// Repaints the destination output and the fee sentence from the typed amount.
const paintProjection = (form: HTMLFormElement): void => {
  const input = form.querySelector<HTMLInputElement>("#privacy-amount");
  const output = form.querySelector<HTMLElement>("#privacy-result-amount");
  const feeNote = form.querySelector<HTMLElement>("[data-privacy-fee]");
  if (!input || !output) {
    return;
  }
  const context = composeContext(form, form.dataset["tokenAddress"] ?? "0x0");
  const projection = projectPrivacyMove({ ...context, amount: input.value });
  output.textContent = projection.received;
  if (feeNote) {
    feeNote.textContent = projection.feeNote;
    feeNote.toggleAttribute("hidden", projection.feeNote === "");
  }
};

// Max fills the source balance less any fee charged in the same asset, so the
// composed amount always remains affordable.
const bindAmountShortcuts = (deps: PrivacyUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#privacy-deposit-form");
  const input = deps.app?.querySelector<HTMLInputElement>("#privacy-amount");
  if (!form || !input) {
    return;
  }
  input.addEventListener("input", () => paintProjection(form));
  form.querySelectorAll<HTMLButtonElement>("[data-privacy-amount]").forEach((button) => {
    button.addEventListener("click", () => {
      input.value = maxPrivacyMove(composeContext(form, form.dataset["tokenAddress"] ?? "0x0"));
      paintProjection(form);
    });
  });
  paintProjection(form);
};

// Repaints both panel labels and balance lines for the active direction.
const paintDirection = (form: HTMLFormElement, unshielding: boolean): void => {
  const text = (selector: string, value: string): void => {
    const node = form.querySelector(selector);
    if (node) {
      node.textContent = value;
    }
  };
  const publicFormatted = form.dataset["publicFormatted"] ?? "0";
  const privateFormatted = form.dataset["privateFormatted"] ?? "0";
  text('[data-privacy-side-label="source"]', unshielding ? "Private balance" : "Public balance");
  text(
    '[data-privacy-side-label="destination"]',
    unshielding ? "Public balance" : "Private balance",
  );
  text('[data-privacy-side-balance="source"]', unshielding ? privateFormatted : publicFormatted);
  text(
    '[data-privacy-side-balance="destination"]',
    unshielding ? publicFormatted : privateFormatted,
  );
  const title = form.ownerDocument.querySelector(".flow-title h1");
  if (title) {
    title.textContent = unshielding ? "Unshield" : "Shield";
  }
};

// Flips which balance is the source. Unshield reveals the destination address
// field; shielding always lands in this account's own private balance.
const bindDirectionFlip = (deps: PrivacyUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#privacy-deposit-form");
  const flip = deps.app?.querySelector<HTMLButtonElement>("#privacy-flip");
  const submit = deps.app?.querySelector<HTMLButtonElement>("#privacy-review-submit");
  if (!form || !flip || !submit) {
    return;
  }
  flip.addEventListener("click", () => {
    const unshielding = form.dataset["direction"] !== "unshield";
    form.dataset["direction"] = unshielding ? "unshield" : "shield";
    paintDirection(form, unshielding);
    paintProjection(form);
    submit.textContent = unshielding ? "Review unshielding" : "Review shielding";
    form
      .querySelector<HTMLElement>("[data-privacy-recipient-row]")
      ?.toggleAttribute("hidden", !unshielding);
  });
};

// The review's amount is editable: an edit re-prepares the deposit so its fee
// quote and frozen digest always match the amount on screen. Confirm is
// disabled until the new preparation lands.
const bindReviewAmount = (
  deps: PrivacyUiDeps,
  journey: Extract<PrivacyJourneyState, { readonly stage: "activate-review" | "deposit-review" }>,
): void => {
  const input = deps.app?.querySelector<HTMLInputElement>("#privacy-review-amount");
  const confirm = deps.app?.querySelector<HTMLButtonElement>("#privacy-confirm");
  const result = deps.app?.querySelector<HTMLElement>("#privacy-review-result");
  if (!input || !confirm) {
    return;
  }
  input.addEventListener("change", () => {
    const amount = input.value.trim();
    if (amount === (journey.preparation.amount ?? "")) {
      return;
    }
    const scope = captureScope(deps);
    confirm.disabled = true;
    if (result) {
      result.textContent = "Re-checking this amount…";
    }
    const reprepared =
      journey.preparation.kind === "withdraw" && journey.preparation.recipient
        ? deps.wallet.preparePrivacyWithdraw(journey.tokenId, journey.preparation.recipient, amount)
        : deps.wallet.preparePrivacyDeposit(journey.tokenId, amount);
    void reprepared.then(
      (preparation) => {
        if (!scopeMatches(deps, scope)) {
          return;
        }
        deps.setJourney({ preparation, stage: "deposit-review", tokenId: journey.tokenId });
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
      },
    );
  });
};

const bindCompose = (deps: PrivacyUiDeps, tokenId: string): void => {
  bindAmountShortcuts(deps);
  bindDirectionFlip(deps);
  const form = deps.app?.querySelector<HTMLFormElement>("#privacy-deposit-form");
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const result = deps.app?.querySelector<HTMLElement>("#privacy-compose-result");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const amount = String(data.get("amount") ?? "").trim();
    const unshielding = form.dataset["direction"] === "unshield";
    const typedRecipient = String(data.get("withdrawRecipient") ?? "").trim();
    const recipient =
      typedRecipient ||
      deps.status().accounts.find((account) => account.id === deps.status().activeAccountId)
        ?.address;
    const scope = captureScope(deps);
    buttonBusy(submit, true);
    const prepared =
      unshielding && recipient
        ? deps.wallet.preparePrivacyWithdraw(tokenId, recipient, amount)
        : deps.wallet.preparePrivacyDeposit(tokenId, amount);
    void prepared.then(
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
        const message = errorMessage(
          error,
          unshielding ? "Unshielding preparation failed" : "Shielding preparation failed",
        );
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
  if (journey.stage === "deposit-review") {
    bindReviewAmount(deps, journey);
  }
  const button = deps.app?.querySelector<HTMLButtonElement>("#privacy-confirm");
  button?.addEventListener("click", () => {
    // Private sends run inside the Send flow, never this journey surface;
    // registration, shielding, and unshielding all confirm here.
    const kind = journey.preparation.kind;
    if (kind === "transfer") {
      return;
    }
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
      deps.setDisclosure({ error: null, loading: false, value: null });
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
      deps.setDisclosure({ error: null, loading: false, value: null });
      const scope = captureScope(deps);
      void loadDisclosure(deps).then((loaded) => {
        if (loaded && scopeMatches(deps, scope)) {
          deps.navigate("home");
        }
      });
    });
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
  if (journey.stage === "compose") {
    bindCompose(deps, journey.tokenId);
  } else if (journey.stage === "activate-review" || journey.stage === "deposit-review") {
    bindConfirmation(deps, journey);
  } else {
    bindOutcome(deps, journey);
  }
};
