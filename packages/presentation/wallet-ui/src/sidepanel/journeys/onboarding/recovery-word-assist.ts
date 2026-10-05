/**
 * Per-word BIP39 English assist for the recovery import grid: unknown-word
 * errors and prefix completions. Full phrase checksum validation stays on the
 * Continue path through Krusty.
 */

import { isBip39EnglishWord, suggestBip39EnglishWords } from "../../../recovery/bip39-english";

const SUGGESTION_LIMIT = 5;

/**
 * Binds spell-check and completion UI onto the import recovery inputs.
 * Returns helpers the onboarding binder uses for advisory word feedback.
 */
export const bindRecoveryWordAssist = (
  inputs: readonly HTMLInputElement[],
  host: HTMLElement,
): {
  readonly hideSuggestions: () => void;
  readonly refreshWordValidity: () => void;
  readonly wordsKnown: (count: number) => boolean;
} => {
  const doc = host.ownerDocument;
  const panel = doc.createElement("div");
  panel.className = "recovery-suggestions";
  panel.hidden = true;
  panel.setAttribute("role", "listbox");
  host.append(panel);

  let activeInput: HTMLInputElement | null = null;

  const hideSuggestions = (): void => {
    panel.hidden = true;
    panel.replaceChildren();
    activeInput = null;
  };

  const markWord = (input: HTMLInputElement): void => {
    const value = input.value.trim();
    const invalid = value.length > 0 && !isBip39EnglishWord(value);
    input.classList.toggle("is-invalid", invalid);
    input.setAttribute("aria-invalid", invalid ? "true" : "false");
  };

  const refreshWordValidity = (): void => {
    for (const input of inputs) {
      if (!input.hidden) {
        markWord(input);
      }
    }
  };

  const wordsKnown = (count: number): boolean =>
    inputs.slice(0, count).every((input) => isBip39EnglishWord(input.value));

  const applySuggestion = (target: HTMLInputElement, word: string): void => {
    const field = inputs.find((input) => input === target);
    if (!field) {
      return;
    }
    field.value = word;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    hideSuggestions();
    const index = inputs.indexOf(field);
    inputs[index + 1]?.focus();
  };

  const showSuggestions = (input: HTMLInputElement): void => {
    const prefix = input.value.trim().toLowerCase();
    const matches = suggestBip39EnglishWords(prefix, SUGGESTION_LIMIT).filter(
      (word) => word !== prefix,
    );
    if (matches.length === 0) {
      hideSuggestions();
      return;
    }
    activeInput = input;
    panel.replaceChildren();
    for (const word of matches) {
      const option = doc.createElement("button");
      option.type = "button";
      option.className = "recovery-suggestion";
      option.setAttribute("role", "option");
      option.textContent = word;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        applySuggestion(input, word);
      });
      panel.append(option);
    }
    const rect = input.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    panel.style.left = `${rect.left - hostRect.left}px`;
    panel.style.top = `${rect.bottom - hostRect.top + 4}px`;
    panel.style.width = `${Math.max(rect.width, 120)}px`;
    panel.hidden = false;
  };

  for (const input of inputs) {
    input.addEventListener("input", () => {
      markWord(input);
      if (doc.activeElement === input) {
        showSuggestions(input);
      }
    });
    input.addEventListener("focus", () => showSuggestions(input));
    input.addEventListener("blur", () => {
      markWord(input);
      // Defer hide so a suggestion mousedown can apply first.
      queueMicrotask(() => {
        if (activeInput === input) {
          hideSuggestions();
        }
      });
    });
    // Tab or Enter completes a partial word only. A cell that already holds a
    // wordlist word keeps it, even when longer words share the prefix ("act"
    // still offers "action"): replacing a correct word would restore a
    // different seed, or leave a checksum error retyping cannot fix.
    input.addEventListener("keydown", (event) => {
      const completes = event.key === "Enter" || (event.key === "Tab" && !event.shiftKey);
      if (!completes || isBip39EnglishWord(input.value)) {
        return;
      }
      // The panel must still describe this cell's value: a paste fills the
      // cells without an input event and leaves the old panel up, and its
      // first word would otherwise overwrite whatever was pasted.
      const first = panel.querySelector<HTMLButtonElement>(".recovery-suggestion");
      const prefix = input.value.trim().toLowerCase();
      const word = first?.textContent ?? "";
      if (
        panel.hidden ||
        activeInput !== input ||
        prefix.length === 0 ||
        !word.startsWith(prefix)
      ) {
        return;
      }
      event.preventDefault();
      applySuggestion(input, word);
    });
  }

  return { hideSuggestions, refreshWordValidity, wordsKnown };
};
