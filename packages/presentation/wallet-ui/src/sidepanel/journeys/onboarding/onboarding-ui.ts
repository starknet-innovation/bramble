/**
 * Onboarding binder for the create-wallet form. Generating a fresh recovery
 * phrase blurs the phrase behind an explicit reveal toggle and shows the
 * confirmation inputs, blocking wallet creation until the requested words are
 * re-typed correctly; pasting an existing phrase skips both the mask and
 * verification. Wallet creation also stays gated until the vault passphrase
 * satisfies the encrypted-store length invariant and, on Mainnet, the user
 * accepts the real-funds acknowledgement.
 */

import { type AccountContractType, isAccountContractType } from "@mc-wallet/wallet-model/accounts";
import { isVaultPassphrase } from "@mc-wallet/wallet-model/passphrase";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import { verifyBackupWords } from "./backup-verify";
import { MAINNET_NETWORK_ID, mainnetAckSatisfied } from "./mainnet-ack";
import { createOnboardingStepTransition, type OnboardingDirection } from "./onboarding-transition";
import { bindRecoveryImportControls } from "./recovery-import-bind";
import { bindRecoveryWordAssist } from "./recovery-word-assist";

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
 * is sent only to the privileged KMS-backed validate/preview/create messages.
 * Import Continue asks Krusty to validate the phrase before the passphrase
 * step; preview returns public account metadata and writes nothing; creation
 * remains the final, explicitly confirmed step.
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
  const accountContractSelect = form.querySelector<HTMLSelectElement>(
    'select[name="accountContractType"]',
  );
  const previewAddress = form.querySelector<HTMLElement>("[data-preview-address]");
  const phraseToggle = form.querySelector<HTMLButtonElement>("#phrase-toggle");
  const generatedGrid = form.querySelector<HTMLElement>('[data-recovery-grid="generated"]');
  const walletReady = form.dataset["walletReady"] === "true";
  const history: string[] = ["welcome"];
  let mnemonic = "";
  let importWordCount: 12 | 24 = 12;
  let generatedWasRevealed = false;
  let requiresVerification = false;
  let accountSelected = false;
  let previewMatchesInput = false;
  let previewGeneration = 0;
  let mnemonicGeneration = 0;
  const accountContractType = (): AccountContractType | null =>
    isAccountContractType(accountContractSelect?.value) ? accountContractSelect.value : null;

  const stepFor = (id: string): HTMLElement | undefined =>
    steps.find((step) => step.dataset["onboardingStep"] === id);
  const transitionStep = createOnboardingStepTransition(app, steps);

  let invalidateValidation = (): void => {};
  let refreshRecovery = (): void => {};

  const showStep = (id: string, direction: OnboardingDirection = "forward", push = true): void => {
    const next = stepFor(id);
    const current = steps.find((step) => !step.hidden);
    if (!next || current === next) {
      return;
    }
    if (current?.dataset["onboardingStep"] === "welcome" && id !== "generated") {
      mnemonicGeneration += 1;
    }
    const wasRecovery = current?.dataset["onboardingStep"] === "recovery";
    const nextIsRecovery = id === "recovery";
    if (push && history.at(-1) !== id) {
      history.push(id);
    }
    transitionStep(next, direction);
    if (wasRecovery !== nextIsRecovery) {
      invalidateValidation();
      if (nextIsRecovery) {
        refreshRecovery();
      }
    }
  };

  const goBack = (): void => {
    if (history.length > 1) {
      invalidatePreview();
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
    inputs.slice(0, count).map((input) => input.value.trim().toLowerCase());

  const importedMnemonic = (): string => wordsFrom(importInputs, importWordCount).join(" ").trim();

  const fillWords = (
    inputs: readonly HTMLInputElement[],
    words: readonly string[],
    kind: "generated" | "import",
  ): void => {
    const count: 12 | 24 = words.length > 12 ? 24 : 12;
    setWordCount(inputs, count, kind);
    for (const [index, input] of inputs.entries()) {
      input.value = (words[index] ?? "").trim().toLowerCase();
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

  const recoveryFields = form.querySelector<HTMLElement>(
    '[data-onboarding-step="recovery"] .onboarding-fields',
  );
  const wordAssist = bindRecoveryWordAssist(importInputs, recoveryFields ?? form);

  refreshRecovery = (): void => {
    const words = wordsFrom(importInputs, importWordCount);
    const incomplete = words.some((word) => word.length === 0);
    const unknown = !incomplete && !wordAssist.wordsKnown(importWordCount);
    wordAssist.refreshWordValidity();
    if (recoveryContinue) {
      // Emptiness only — BIP39 membership stays advisory; Krusty validates.
      recoveryContinue.disabled = incomplete;
    }
    if (recoveryResult) {
      recoveryResult.textContent = incomplete
        ? words.some((word) => word.length > 0)
          ? `Enter all ${importWordCount} words to continue.`
          : ""
        : unknown
          ? "Highlighted words are not in the BIP39 English list."
          : "";
    }
    invalidatePreview();
  };

  const passwordOk = (): boolean => {
    const value = passphraseInput?.value ?? "";
    return isVaultPassphrase(value) && value === (confirmationInput?.value ?? "");
  };

  const invalidatePreview = (): void => {
    previewGeneration += 1;
    previewMatchesInput = false;
    buttonBusy(reviewAccount, false);
    if (reviewAccount) {
      reviewAccount.disabled = !passwordOk();
    }
  };

  const refreshPassword = (): void => {
    const value = passphraseInput?.value ?? "";
    const confirmation = confirmationInput?.value ?? "";
    const validLength = isVaultPassphrase(value);
    const matches = value === confirmation && confirmation.length > 0;
    if (passwordResult) {
      passwordResult.textContent = !validLength
        ? "Enter at least 12 characters"
        : matches
          ? "Passphrases match"
          : "Passphrases do not match";
    }
    passwordRequirement?.classList.toggle("is-ready", validLength && matches);
    if (reviewAccount) {
      reviewAccount.disabled = !passwordOk();
    }
    if (passphraseResult) {
      passphraseResult.textContent =
        confirmation.length > 0 && !matches ? "Enter the same passphrase in both fields." : "";
    }
    invalidatePreview();
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

  const refreshAccountGate = (): void => {
    if (submitButton) {
      submitButton.disabled = !(
        walletReady &&
        accountSelected &&
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
    invalidateValidation();
    refreshRecovery();
  });

  ({ invalidateValidation } = bindRecoveryImportControls({
    fillWords,
    importInputs,
    importedMnemonic,
    importWordCount: () => importWordCount,
    isRecoveryActive: () =>
      steps.find((step) => !step.hidden)?.dataset["onboardingStep"] === "recovery",
    recoveryContinue,
    recoveryResult,
    refreshPassword,
    refreshRecovery,
    setMnemonic: (phrase) => {
      mnemonic = phrase;
    },
    showPasswordStep: () => showStep("password"),
    wallet,
    wordAssist,
  }));

  const createNew = form.querySelector<HTMLButtonElement>("#create-new-button");
  createNew?.addEventListener("click", () => {
    const generation = ++mnemonicGeneration;
    buttonBusy(createNew, true);
    void wallet.generateMnemonic().then(
      (generated) => {
        if (generation !== mnemonicGeneration) {
          buttonBusy(createNew, false);
          return;
        }
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
        if (generation !== mnemonicGeneration) {
          buttonBusy(createNew, false);
          return;
        }
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
  accountContractSelect?.addEventListener("change", () => {
    invalidatePreview();
    accountSelected = false;
    accountButton?.setAttribute("aria-pressed", "false");
    refreshAccountGate();
  });

  reviewAccount?.addEventListener("click", () => {
    if (!passwordOk()) {
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
    const contractType = accountContractType();
    if (!contractType) {
      showToast("Choose a supported account contract", "error");
      buttonBusy(reviewAccount, false);
      return;
    }
    const generation = ++previewGeneration;
    void wallet.previewAccount(mnemonic, selectedNetworkId(), contractType).then(
      (account) => {
        if (generation !== previewGeneration) {
          return;
        }
        if (contractType !== accountContractType()) {
          invalidatePreview();
          return;
        }
        accountSelected = false;
        accountButton?.setAttribute("aria-pressed", "false");
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
      },
      (error: unknown) => {
        if (generation !== previewGeneration) {
          return;
        }
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
    if (!accountSelected || !previewMatchesInput) {
      if (result) {
        result.textContent = "Select the account before continuing.";
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
    const contractType = accountContractType();
    if (!contractType) {
      showToast("Choose a supported account contract", "error");
      buttonBusy(submitButton, false);
      return;
    }
    void wallet
      .createAccount(mnemonic, selectedNetworkId(), passphraseInput?.value ?? "", contractType)
      .then(
        async () => {
          showToast("Wallet created", "success");
          await deps.render(await wallet.loadStatus());
        },
        (error: unknown) => {
          const message = errorMessage(error, "Account import failed");
          showToast(message, "error");
          if (result) {
            result.textContent = message;
          }
          buttonBusy(submitButton, false);
        },
      );
  });

  syncNetworkGate();
  refreshRecovery();
  refreshPassword();
};
