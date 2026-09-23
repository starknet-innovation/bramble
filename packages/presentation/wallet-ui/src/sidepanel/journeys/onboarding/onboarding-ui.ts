/** First-run recovery, account preview, and persistence bindings. */

import { isCreatableAccountContractType } from "@bramble/wallet-model/accounts";
import { isVaultPassphrase } from "@bramble/wallet-model/passphrase";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import { BACKUP_VERIFY_COPY, backupVerifyState } from "./backup-verify";
import { bindKeyImport } from "./import-key-ui";
import { MAINNET_NETWORK_ID, mainnetAckSatisfied } from "./mainnet-ack";
import { createOnboardingStepTransition, type OnboardingDirection } from "./onboarding-transition";
import { applyPassphraseMeter } from "./passphrase-meter";
import { bindRecoveryAccountUi } from "./recovery-account-ui";
import { bindRecoveryImportControls } from "./recovery-import-bind";
import { bindRecoveryWordAssist } from "./recovery-word-assist";
import {
  fillRecoveryWords,
  recoveryWordsFrom,
  setGeneratedPhraseMasked,
  setRecoveryWordCount,
} from "./recovery-word-state";
import { createWeakPassphraseAck } from "./weak-passphrase-ack";

/** Dependencies the onboarding binding closes over. */
export type OnboardingUiDeps = {
  readonly app: Element | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

/** Binds the staged first-run journey without retaining recovery material. */
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
  const weakAck = createWeakPassphraseAck(form, "", passphraseInput, () => refreshPassword());
  const ackContainer = form.querySelector<HTMLElement>("#mainnet-ack");
  const ackCheckbox = form.querySelector<HTMLInputElement>('input[name="mainnetAck"]');
  const recoveryContinue = form.querySelector<HTMLButtonElement>("#recovery-continue");
  const generatedContinue = form.querySelector<HTMLButtonElement>("#generated-continue");
  const verifyContinue = form.querySelector<HTMLButtonElement>("#verify-continue");
  const passwordContinue = form.querySelector<HTMLButtonElement>("#password-continue-button");
  const submitButton = form.querySelector<HTMLButtonElement>("#create-wallet-button");
  const accountButton = form.querySelector<HTMLButtonElement>("#account-preview");
  const accountContractInput = form.querySelector<HTMLInputElement>(
    'input[name="accountContractType"]',
  );
  const previewAddress = form.querySelector<HTMLElement>("[data-preview-address]");
  const previewLabel = form.querySelector<HTMLElement>("[data-preview-label]");
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
  const accountContractType = () =>
    isCreatableAccountContractType(accountContractInput?.value) ? accountContractInput.value : null;

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

  const importedMnemonic = (): string =>
    recoveryWordsFrom(importInputs, importWordCount).join(" ").trim();

  const fillWords = (
    inputs: readonly HTMLInputElement[],
    words: readonly string[],
    kind: "generated" | "import",
  ): void => {
    const count = fillRecoveryWords(form, inputs, words, kind);
    if (kind === "import") importWordCount = count;
  };

  const recoveryFields = form.querySelector<HTMLElement>(
    '[data-onboarding-step="recovery"] .onboarding-fields',
  );
  const wordAssist = bindRecoveryWordAssist(importInputs, recoveryFields ?? form);

  refreshRecovery = (): void => {
    const words = recoveryWordsFrom(importInputs, importWordCount);
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
    return isVaultPassphrase(value) && value === (confirmationInput?.value ?? "") && weakAck.ok();
  };

  const invalidatePreview = (): void => {
    previewGeneration += 1;
    previewMatchesInput = false;
    if (passwordContinue) {
      passwordContinue.disabled = !passwordOk();
    }
  };

  const refreshPassword = (): void => {
    const value = passphraseInput?.value ?? "";
    const confirmation = confirmationInput?.value ?? "";
    const matches = value === confirmation && confirmation.length > 0;
    weakAck.sync();
    applyPassphraseMeter(
      { requirement: passwordRequirement, result: passwordResult },
      value,
      confirmation,
    );
    if (passwordContinue) {
      passwordContinue.disabled = !passwordOk();
    }
    if (passphraseResult) {
      passphraseResult.textContent =
        confirmation.length > 0 && !matches ? "Enter the same passphrase in both fields." : "";
    }
    invalidatePreview();
  };

  const verifyAnswers = () => verifyInputs.map((input) => input.value);
  const verificationState = () => backupVerifyState(mnemonic, verifyAnswers());
  const verificationSatisfied = () => verificationState() === "confirmed";

  // A mismatch shows on commit (blur/Enter) or a Continue attempt, never mid-typing.
  const refreshVerification = (reportMismatch = false): void => {
    const state = verificationState();
    const shown = state === "mismatch" && !reportMismatch ? "incomplete" : state;
    verifyContinue?.toggleAttribute("disabled", state !== "confirmed");
    if (verifyResult) {
      verifyResult.textContent = BACKUP_VERIFY_COPY[shown];
      verifyResult.classList.toggle("is-invalid", shown === "mismatch");
    }
  };

  const selectedNetworkId = (): string => MAINNET_NETWORK_ID;
  const recoveryAccounts = bindRecoveryAccountUi({
    form,
    mnemonic: () => mnemonic,
    networkId: selectedNetworkId,
    render: deps.render,
    vaultPassphrase: () => passphraseInput?.value ?? "",
    wallet,
  });
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
  const keyImport = bindKeyImport({
    form,
    networkId: selectedNetworkId,
    onEnter: () => {
      requiresVerification = false;
    },
    passphrase: () => passphraseInput?.value ?? "",
    passwordContinue,
    render: deps.render,
    showStep: (id: string) => {
      showStep(id);
      refreshPassword();
    },
    wallet,
  });
  form.querySelector("#recovery-method-button")?.addEventListener("click", () => {
    requiresVerification = false;
    keyImport.deactivate();
    passwordContinue?.lastChild?.replaceWith("Find my accounts");
    showStep("recovery");
  });
  form.querySelector("#ledger-method-button")?.addEventListener("click", () => showStep("ledger"));

  form.querySelector("#phrase-length-toggle")?.addEventListener("click", () => {
    importWordCount = importWordCount === 12 ? 24 : 12;
    setRecoveryWordCount(form, importInputs, importWordCount, "import");
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
      keyImport.deactivate();
      passwordContinue?.lastChild?.replaceWith("Find my accounts");
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
        keyImport.deactivate();
        passwordContinue?.lastChild?.replaceWith("Review account");
        requiresVerification = true;
        generatedWasRevealed = false;
        setGeneratedPhraseMasked(generatedGrid, generatedInputs, true);
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
        showToast(message, "error", form);
        buttonBusy(createNew, false);
      },
    );
  });

  phraseToggle?.addEventListener("click", () => {
    const masked = !(generatedGrid?.classList.contains("is-masked") ?? false);
    setGeneratedPhraseMasked(generatedGrid, generatedInputs, masked);
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
    input.addEventListener("input", () => refreshVerification());
    input.addEventListener("change", () => refreshVerification(true));
  }
  verifyContinue?.parentElement?.addEventListener("click", () => {
    refreshVerification(true);
    if (verificationSatisfied()) {
      showStep("password");
      refreshPassword();
    }
  });

  passphraseInput?.addEventListener("input", refreshPassword);
  confirmationInput?.addEventListener("input", refreshPassword);
  passwordContinue?.addEventListener("click", () => {
    if (!passwordOk()) {
      refreshPassword();
      return;
    }
    if (keyImport.active()) {
      void keyImport.runCreate();
      return;
    }
    if (requiresVerification) {
      runReviewAccount();
      return;
    }
    showStep("recovery-accounts");
    recoveryAccounts.start();
  });
  ackCheckbox?.addEventListener("change", refreshAccountGate);
  accountButton?.addEventListener("click", () => {
    accountSelected = !(accountButton.getAttribute("aria-pressed") === "true");
    accountButton.setAttribute("aria-pressed", String(accountSelected));
    refreshAccountGate();
  });
  const runReviewAccount = (): void => {
    if (!passwordOk()) {
      refreshPassword();
      return;
    }
    if (requiresVerification && !verificationSatisfied()) {
      showToast("Confirm your recovery phrase first", "error", form);
      return;
    }
    buttonBusy(passwordContinue, true);
    if (passphraseResult) {
      passphraseResult.textContent = "Deriving the public account address…";
    }
    const contractType = accountContractType();
    if (!contractType) {
      showToast("Choose a supported account contract", "error", form);
      buttonBusy(passwordContinue, false);
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
        if (previewLabel) {
          previewLabel.textContent =
            contractType === "argent" ? "Primary Ready account" : "Primary Bramble account";
        }
        if (passphraseResult) {
          passphraseResult.textContent = "";
        }
        syncNetworkGate();
        previewMatchesInput = true;
        refreshAccountGate();
        showStep("accounts");
        buttonBusy(passwordContinue, false);
      },
      (error: unknown) => {
        if (generation !== previewGeneration) {
          return;
        }
        const message = errorMessage(error, "Could not derive this account");
        if (passphraseResult) {
          passphraseResult.textContent = message;
        }
        showToast(message, "error", form);
        buttonBusy(passwordContinue, false);
      },
    );
  };

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
      showToast("Acknowledge the real-funds warning first", "error", form);
      return;
    }
    buttonBusy(submitButton, true);
    const contractType = accountContractType();
    if (!contractType) {
      showToast("Choose a supported account contract", "error", form);
      buttonBusy(submitButton, false);
      return;
    }
    void wallet
      .createAccount(mnemonic, selectedNetworkId(), passphraseInput?.value ?? "", contractType)
      .then(
        async () => {
          showToast("Wallet created", "success", form);
          await deps.render(await wallet.loadStatus());
        },
        (error: unknown) => {
          const message = errorMessage(error, "Account import failed");
          showToast(message, "error", form);
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
