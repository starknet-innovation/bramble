/**
 * Onboarding binder for the create-wallet form. Generating a fresh recovery
 * phrase blurs the phrase behind an explicit reveal toggle and shows the
 * confirmation inputs, blocking wallet creation until the requested words are
 * re-typed correctly; pasting an existing phrase skips both the mask and
 * verification. Wallet creation also stays gated until the vault passphrase
 * satisfies the encrypted-store length invariant and, on Mainnet, the user
 * accepts the real-funds acknowledgement.
 */
import type { WalletStatus } from "../popup/responses";
import { verifyBackupWords } from "./backup-verify";
import {
  createDiscoveredAccountsPanel,
  renderSetupScan,
  setupScanFailedMessage,
} from "./discovered-accounts-ui";
import { buttonBusy, errorMessage, showToast } from "./dom";
import { MAINNET_NETWORK_ID, mainnetAckSatisfied } from "./mainnet-ack";
import { createOnboardingStepTransition, type OnboardingDirection } from "./onboarding-transition";
import { createWalletWithAccounts } from "./restore-accounts";
import type { SidepanelWallet } from "./runtime";
import { vaultPassphraseState } from "./vault-passphrase-fields";

/**
 * Dependencies the onboarding binding closes over.
 */
export type OnboardingUiDeps = {
  readonly app: Element | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

/**
 * Binds the staged first-run journey. Recovery material stays in this page and
 * is sent only to the privileged KMS-backed preview/create messages. Preview
 * returns public account metadata and writes nothing; creation remains the
 * final, explicitly confirmed step.
 */
export const bindOnboarding = (deps: OnboardingUiDeps): void => {
  const { app, wallet } = deps;
  const form = app?.querySelector<HTMLFormElement>("#create-form");
  if (!form) {
    return;
  }
  const steps = Array.from(app?.querySelectorAll<HTMLElement>("[data-onboarding-step]") ?? []);
  const importInputs = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[data-recovery-kind="import"]'),
  );
  const generatedInputs = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[data-recovery-kind="generated"]'),
  );
  const verifyInputs = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[name^="verify-"]'),
  );
  const passphraseInput = form.querySelector<HTMLInputElement>('input[name="vaultPassphrase"]');
  const confirmationInput = form.querySelector<HTMLInputElement>(
    'input[name="vaultPassphraseConfirm"]',
  );
  const passwordResult = form.querySelector<HTMLElement>("[data-password-result]");
  const passwordRequirement = passwordResult?.closest<HTMLElement>(".password-requirement");
  const passphraseResult = form.querySelector<HTMLElement>("#passphrase-result");
  const verifyResult = form.querySelector<HTMLElement>("#verify-result");
  const recoveryResult = form.querySelector<HTMLElement>("#recovery-result");
  const generateResult = form.querySelector<HTMLElement>("#generate-result");
  const result = form.querySelector<HTMLElement>("#form-result");
  const ackContainer = form.querySelector<HTMLElement>("#mainnet-ack");
  const ackCheckbox = form.querySelector<HTMLInputElement>('input[name="mainnetAck"]');
  const recoveryContinue = form.querySelector<HTMLButtonElement>("#recovery-continue");
  const generatedContinue = form.querySelector<HTMLButtonElement>("#generated-continue");
  const verifyContinue = form.querySelector<HTMLButtonElement>("#verify-continue");
  const reviewAccount = form.querySelector<HTMLButtonElement>("#review-account-button");
  const submitButton = form.querySelector<HTMLButtonElement>("#create-wallet-button");
  const accountButton = form.querySelector<HTMLButtonElement>("#account-preview");
  const previewAddress = form.querySelector<HTMLElement>("[data-preview-address]");
  const discoveredList = form.querySelector<HTMLElement>("#discovered-accounts");
  const discoveredResult = form.querySelector<HTMLElement>("#discovered-result");
  const phraseToggle = form.querySelector<HTMLButtonElement>("#phrase-toggle");
  const generatedGrid = form.querySelector<HTMLElement>('[data-recovery-grid="generated"]');
  const walletReady = form.dataset["walletReady"] === "true";
  const history: string[] = ["welcome"];
  let mnemonic = "";
  let importWordCount: 12 | 24 = 12;
  let generatedWasRevealed = false;
  let requiresVerification = false;
  let accountSelected = true;
  let previewMatchesInput = false;

  const stepFor = (id: string): HTMLElement | undefined =>
    steps.find((step) => step.dataset["onboardingStep"] === id);
  const transitionStep = createOnboardingStepTransition(app, steps);

  const showStep = (id: string, direction: OnboardingDirection = "forward", push = true): void => {
    const next = stepFor(id);
    const current = steps.find((step) => !step.hidden);
    if (!next || current === next) {
      return;
    }
    if (push && history.at(-1) !== id) {
      history.push(id);
    }
    transitionStep(next, direction);
  };

  const goBack = (): void => {
    if (history.length > 1) {
      history.pop();
      showStep(history.at(-1) ?? "welcome", "back", false);
    }
  };

  const setWordCount = (
    inputs: readonly HTMLInputElement[],
    count: 12 | 24,
    kind: "generated" | "import",
  ): void => {
    for (const [index, input] of inputs.entries()) {
      input.hidden = index >= count;
    }
    if (kind === "import") {
      importWordCount = count;
      const toggle = form.querySelector<HTMLButtonElement>("#phrase-length-toggle");
      if (toggle) {
        toggle.textContent = count === 12 ? "Use a 24-word phrase" : "Use a 12-word phrase";
      }
    }
  };

  const wordsFrom = (inputs: readonly HTMLInputElement[], count: number): readonly string[] =>
    inputs.slice(0, count).map((input) => input.value.trim());

  const importedMnemonic = (): string => wordsFrom(importInputs, importWordCount).join(" ").trim();

  const fillWords = (
    inputs: readonly HTMLInputElement[],
    words: readonly string[],
    kind: "generated" | "import",
  ): void => {
    const count: 12 | 24 = words.length > 12 ? 24 : 12;
    setWordCount(inputs, count, kind);
    for (const [index, input] of inputs.entries()) {
      input.value = words[index] ?? "";
    }
  };

  const setGeneratedPhraseMasked = (masked: boolean): void => {
    generatedGrid?.classList.toggle("is-masked", masked);
    generatedGrid?.toggleAttribute("inert", masked);
    if (masked) {
      generatedGrid?.setAttribute("aria-hidden", "true");
    } else {
      generatedGrid?.removeAttribute("aria-hidden");
    }
    for (const input of generatedInputs) {
      input.tabIndex = masked ? -1 : 0;
    }
  };

  const refreshRecovery = (): void => {
    const words = wordsFrom(importInputs, importWordCount);
    if (recoveryContinue) {
      recoveryContinue.disabled = words.some((word) => word.length === 0);
    }
    if (recoveryResult) {
      recoveryResult.textContent =
        words.some((word) => word.length === 0) && words.some((word) => word.length > 0)
          ? `Enter all ${importWordCount} words to continue.`
          : "";
    }
    previewMatchesInput = false;
  };

  const passwordState = () =>
    vaultPassphraseState(passphraseInput?.value ?? "", confirmationInput?.value ?? "");

  const refreshPassword = (): void => {
    const state = passwordState();
    if (passwordResult) {
      passwordResult.textContent = state.requirement;
    }
    passwordRequirement?.classList.toggle("is-ready", state.satisfied);
    if (reviewAccount) {
      reviewAccount.disabled = !state.ok;
    }
    if (passphraseResult) {
      passphraseResult.textContent = state.confirmationHint;
    }
    previewMatchesInput = false;
  };

  const verificationSatisfied = (): boolean =>
    verifyBackupWords(
      mnemonic,
      verifyInputs.map((input) => input.value),
    );

  const refreshVerification = (): void => {
    const satisfied = verificationSatisfied();
    if (verifyContinue) {
      verifyContinue.disabled = !satisfied;
    }
    if (verifyResult) {
      verifyResult.textContent = satisfied
        ? "Backup confirmed."
        : "Enter the requested words to continue.";
    }
  };

  const selectedNetworkId = (): string => MAINNET_NETWORK_ID;
  const ackSatisfied = (): boolean =>
    mainnetAckSatisfied(selectedNetworkId(), ackCheckbox?.checked ?? false);

  // Accounts this phrase already has beyond the first. Index 0 is left out: the
  // "Account 1" row above already is it, and listing it twice invites
  // selecting one account and getting two.
  const discovered = createDiscoveredAccountsPanel({
    container: discoveredList,
    onToggle: () => refreshAccountGate(),
  });

  const refreshAccountGate = (): void => {
    if (submitButton) {
      // Either the primary account or any discovered one is enough: a user
      // restoring only accounts 3 and 7 must not be forced to take account 1.
      submitButton.disabled = !(
        walletReady &&
        (accountSelected || discovered.selected().length > 0) &&
        previewMatchesInput &&
        ackSatisfied()
      );
    }
  };

  const syncNetworkGate = (): void => {
    if (ackContainer) {
      ackContainer.hidden = false;
    }
    previewMatchesInput = false;
    refreshAccountGate();
  };

  app?.querySelectorAll<HTMLButtonElement>("[data-onboarding-back]").forEach((button) => {
    button.addEventListener("click", goBack);
  });
  form
    .querySelector('[id="add-existing-button"]')
    ?.addEventListener("click", () => showStep("method"));
  form.querySelector("#recovery-method-button")?.addEventListener("click", () => {
    requiresVerification = false;
    showStep("recovery");
  });
  form.querySelector("#ledger-method-button")?.addEventListener("click", () => showStep("ledger"));

  form.querySelector("#phrase-length-toggle")?.addEventListener("click", () => {
    setWordCount(importInputs, importWordCount === 12 ? 24 : 12, "import");
    refreshRecovery();
  });

  for (const [index, input] of importInputs.entries()) {
    input.addEventListener("input", () => {
      const pastedWords = input.value.trim().split(/\s+/).filter(Boolean);
      if (pastedWords.length === 12 || pastedWords.length === 24) {
        fillWords(importInputs, pastedWords, "import");
      }
      refreshRecovery();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === " " && input.value.trim().length > 0) {
        event.preventDefault();
        importInputs[index + 1]?.focus();
      } else if (event.key === "Backspace" && input.value.length === 0) {
        importInputs[index - 1]?.focus();
      }
    });
    input.addEventListener("paste", (event) => {
      const words = event.clipboardData?.getData("text").trim().split(/\s+/).filter(Boolean) ?? [];
      if (words.length !== 12 && words.length !== 24) {
        return;
      }
      event.preventDefault();
      fillWords(importInputs, words, "import");
      refreshRecovery();
    });
  }

  recoveryContinue?.addEventListener("click", () => {
    mnemonic = importedMnemonic();
    showStep("password");
    refreshPassword();
  });

  const createNew = form.querySelector<HTMLButtonElement>("#create-new-button");
  createNew?.addEventListener("click", () => {
    buttonBusy(createNew, true);
    void wallet.generateMnemonic().then(
      (generated) => {
        mnemonic = generated.trim();
        requiresVerification = true;
        generatedWasRevealed = false;
        setGeneratedPhraseMasked(true);
        fillWords(generatedInputs, mnemonic.split(/\s+/), "generated");
        for (const input of verifyInputs) {
          input.value = "";
        }
        if (generatedContinue) {
          generatedContinue.disabled = true;
        }
        if (generateResult) {
          generateResult.textContent = "Reveal the phrase, save it offline, then continue.";
        }
        showStep("generated");
        buttonBusy(createNew, false);
      },
      (error: unknown) => {
        const message = errorMessage(error, "Recovery phrase failed");
        showToast(message, "error");
        buttonBusy(createNew, false);
      },
    );
  });

  phraseToggle?.addEventListener("click", () => {
    const masked = !(generatedGrid?.classList.contains("is-masked") ?? false);
    setGeneratedPhraseMasked(masked);
    phraseToggle.lastChild?.replaceWith(masked ? "Show recovery phrase" : "Hide recovery phrase");
    if (!masked) {
      generatedWasRevealed = true;
    }
    if (generatedContinue) {
      generatedContinue.disabled = !generatedWasRevealed;
    }
  });

  generatedContinue?.addEventListener("click", () => {
    showStep("verify");
    refreshVerification();
  });
  for (const input of verifyInputs) {
    input.addEventListener("input", refreshVerification);
  }
  verifyContinue?.addEventListener("click", () => {
    if (verificationSatisfied()) {
      showStep("password");
      refreshPassword();
    }
  });

  passphraseInput?.addEventListener("input", refreshPassword);
  confirmationInput?.addEventListener("input", refreshPassword);
  ackCheckbox?.addEventListener("change", refreshAccountGate);
  accountButton?.addEventListener("click", () => {
    accountSelected = !(accountButton.getAttribute("aria-pressed") === "true");
    accountButton.setAttribute("aria-pressed", String(accountSelected));
    refreshAccountGate();
  });

  reviewAccount?.addEventListener("click", () => {
    if (!passwordState().ok) {
      refreshPassword();
      return;
    }
    if (requiresVerification && !verificationSatisfied()) {
      showToast("Confirm your recovery phrase first", "error");
      return;
    }
    buttonBusy(reviewAccount, true);
    if (passphraseResult) {
      passphraseResult.textContent = "Deriving the public account address…";
    }
    void wallet.previewAccount(mnemonic, selectedNetworkId()).then(
      (account) => {
        previewMatchesInput = true;
        accountSelected = true;
        accountButton?.setAttribute("aria-pressed", "true");
        if (previewAddress) {
          previewAddress.textContent = `${account.address.slice(0, 10)}…${account.address.slice(-8)}`;
          previewAddress.title = account.address;
        }
        if (passphraseResult) {
          passphraseResult.textContent = "";
        }
        syncNetworkGate();
        previewMatchesInput = true;
        refreshAccountGate();
        showStep("accounts");
        buttonBusy(reviewAccount, false);
        // A phrase this wallet just generated has nothing on chain by definition,
        // so only a typed one is worth scanning. Best effort: an unreachable node
        // leaves the primary account selectable rather than blocking setup.
        if (!requiresVerification) {
          if (discoveredResult) {
            discoveredResult.textContent = "Looking for your other accounts…";
          }
          const describe = (text: string): void => {
            if (discoveredResult) {
              discoveredResult.textContent = text;
            }
          };
          void wallet.scanSeedAccounts(mnemonic).then(
            (candidates) => describe(renderSetupScan(discovered, candidates)),
            () => describe(setupScanFailedMessage()),
          );
        }
      },
      (error: unknown) => {
        const message = errorMessage(error, "Could not derive this account");
        if (passphraseResult) {
          passphraseResult.textContent = message;
        }
        showToast(message, "error");
        buttonBusy(reviewAccount, false);
      },
    );
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const chosen = [...(accountSelected ? [0] : []), ...discovered.selected()].sort(
      (left, right) => left - right,
    );
    if (chosen.length === 0 || !previewMatchesInput) {
      if (result) {
        result.textContent = "Select at least one account before continuing.";
      }
      return;
    }
    if (!ackSatisfied()) {
      if (result) {
        result.textContent = "Confirm you understand this wallet can hold real funds.";
      }
      showToast("Acknowledge the real-funds warning first", "error");
      return;
    }
    buttonBusy(submitButton, true);
    const networkId = selectedNetworkId();
    void createWalletWithAccounts(wallet, {
      accountIndexes: chosen,
      mnemonic,
      networkId,
      vaultPassphrase: passphraseInput?.value ?? "",
    })
      .then(async (added) => {
        showToast(
          added === 1 ? "Wallet created" : `Wallet created with ${added} accounts`,
          "success",
        );
        await deps.render(await wallet.loadStatus());
      })
      .catch((error: unknown) => {
        const message = errorMessage(error, "Account import failed");
        showToast(message, "error");
        if (result) {
          result.textContent = message;
        }
        buttonBusy(submitButton, false);
      });
  });

  syncNetworkGate();
  refreshRecovery();
  refreshPassword();
};

/**
 * Binds the unlock form on the locked gate screen: submits the passphrase,
 * lands on Home on success, and surfaces failures inline plus as a toast.
 */
export const bindUnlock = (
  deps: OnboardingUiDeps,
  onUnlocked: () => void = () => undefined,
): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#unlock-form");
  const result = deps.app?.querySelector<HTMLElement>("#form-result");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const vaultPassphrase = String(new FormData(form).get("vaultPassphrase") ?? "");
    buttonBusy(submitButton, true);
    void deps.wallet.unlockVault(vaultPassphrase).then(
      async (status) => {
        onUnlocked();
        showToast("Vault unlocked", "success");
        await deps.render(status);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Unlock failed"), "error");
        if (result) {
          result.textContent = errorMessage(error, "Unlock failed");
        }
        buttonBusy(submitButton, false);
      },
    );
  });
};
