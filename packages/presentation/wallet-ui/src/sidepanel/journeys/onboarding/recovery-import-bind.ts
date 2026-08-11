/**
 * Import-grid input wiring for pasting, space-to-advance, and Continue that
 * asks Krusty to validate the full phrase before the passphrase step.
 */

import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";

type WordAssist = {
  readonly hideSuggestions: () => void;
  readonly wordsKnown: (count: number) => boolean;
};

type RecoveryImportBind = {
  readonly fillWords: (
    inputs: readonly HTMLInputElement[],
    words: readonly string[],
    kind: "generated" | "import",
  ) => void;
  readonly importInputs: readonly HTMLInputElement[];
  readonly importWordCount: () => 12 | 24;
  readonly importedMnemonic: () => string;
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
 * Binds paste/space navigation and Krusty-backed Continue on the recovery step.
 */
export const bindRecoveryImportControls = (deps: RecoveryImportBind): void => {
  const {
    fillWords,
    importInputs,
    importWordCount,
    importedMnemonic,
    recoveryContinue,
    recoveryResult,
    refreshPassword,
    refreshRecovery,
    setMnemonic,
    showPasswordStep,
    wallet,
    wordAssist,
  } = deps;

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
    const phrase = importedMnemonic();
    if (!wordAssist.wordsKnown(importWordCount())) {
      refreshRecovery();
      return;
    }
    buttonBusy(recoveryContinue, true);
    if (recoveryResult) {
      recoveryResult.textContent = "Checking recovery phrase…";
    }
    void wallet.validateMnemonic(phrase).then(
      (valid) => {
        buttonBusy(recoveryContinue, false);
        if (!valid) {
          if (recoveryResult) {
            recoveryResult.textContent = "This recovery phrase is not valid.";
          }
          showToast("Invalid recovery phrase", "error");
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
        const message = errorMessage(error, "Could not check this recovery phrase");
        if (recoveryResult) {
          recoveryResult.textContent = message;
        }
        showToast(message, "error");
        buttonBusy(recoveryContinue, false);
      },
    );
  });
};
