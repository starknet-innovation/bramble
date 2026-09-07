/**
 * Import-grid input wiring for pasting, space-to-advance, and Continue that
 * asks Krusty to validate the full phrase before the passphrase step.
 *
 * Local BIP39 membership highlighting stays advisory. Only Krusty's
 * validateMnemonic verdict may advance the flow, and stale async completions
 * are discarded when the phrase, word count, or recovery step has changed.
 */

import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import { bindRecoveryWordEntry } from "./recovery-word-state";

type WordAssist = {
  readonly hideSuggestions: () => void;
};

type RecoveryImportBind = {
  readonly fillWords: (
    inputs: readonly HTMLInputElement[],
    words: readonly string[],
    kind: "generated" | "import",
  ) => void;
  readonly importInputs: readonly HTMLInputElement[];
  readonly importedMnemonic: () => string;
  readonly importWordCount: () => 12 | 24;
  readonly isRecoveryActive: () => boolean;
  readonly recoveryContinue: HTMLButtonElement | null;
  readonly recoveryResult: HTMLElement | null;
  readonly refreshRecovery: () => void;
  readonly refreshPassword: () => void;
  readonly showPasswordStep: () => void;
  readonly setMnemonic: (phrase: string) => void;
  readonly wallet: SidepanelWallet;
  readonly wordAssist: WordAssist;
};

/**
 * Handles returned by the recovery-import binder so onboarding can invalidate
 * in-flight Krusty validation when the step or phrase length changes.
 */
export type RecoveryImportControls = {
  readonly invalidateValidation: () => void;
};

/**
 * Binds paste/space navigation and Krusty-backed Continue on the recovery step.
 * Callers must invalidate in-flight validation on word-count changes and when
 * leaving or re-entering the recovery step.
 */
export const bindRecoveryImportControls = (deps: RecoveryImportBind): RecoveryImportControls => {
  const {
    fillWords,
    importInputs,
    importedMnemonic,
    importWordCount,
    isRecoveryActive,
    recoveryContinue,
    recoveryResult,
    refreshPassword,
    refreshRecovery,
    setMnemonic,
    showPasswordStep,
    wallet,
    wordAssist,
  } = deps;

  let validateGeneration = 0;

  const invalidateValidation = (): void => {
    validateGeneration += 1;
    buttonBusy(recoveryContinue, false);
  };

  bindRecoveryWordEntry({
    fillWords: (words) => fillWords(importInputs, words, "import"),
    inputs: importInputs,
    onBeforeChange: invalidateValidation,
    onChange: refreshRecovery,
  });

  recoveryContinue?.addEventListener("click", () => {
    const phrase = importedMnemonic();
    const wordCount = importWordCount();
    if (phrase.length === 0 || phrase.split(/\s+/).some((word) => word.length === 0)) {
      refreshRecovery();
      return;
    }
    validateGeneration += 1;
    const requestId = validateGeneration;
    buttonBusy(recoveryContinue, true);
    if (recoveryResult) {
      recoveryResult.textContent = "Checking recovery phrase…";
    }
    void wallet.validateMnemonic(phrase).then(
      (valid) => {
        if (
          requestId !== validateGeneration ||
          importedMnemonic() !== phrase ||
          importWordCount() !== wordCount ||
          !isRecoveryActive()
        ) {
          return;
        }
        buttonBusy(recoveryContinue, false);
        if (!valid) {
          if (recoveryResult) {
            recoveryResult.textContent = "This recovery phrase is not valid.";
          }
          showToast("Invalid recovery phrase", "error", recoveryContinue);
          return;
        }
        setMnemonic(phrase);
        if (recoveryResult) {
          recoveryResult.textContent = "";
        }
        wordAssist.hideSuggestions();
        showPasswordStep();
        refreshPassword();
      },
      (error: unknown) => {
        if (
          requestId !== validateGeneration ||
          importedMnemonic() !== phrase ||
          importWordCount() !== wordCount ||
          !isRecoveryActive()
        ) {
          return;
        }
        const message = errorMessage(error, "Could not check this recovery phrase");
        if (recoveryResult) {
          recoveryResult.textContent = message;
        }
        showToast(message, "error", recoveryContinue);
        buttonBusy(recoveryContinue, false);
      },
    );
  });

  return { invalidateValidation };
};
