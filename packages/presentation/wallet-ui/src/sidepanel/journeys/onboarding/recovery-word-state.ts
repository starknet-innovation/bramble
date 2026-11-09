/**
 * Small DOM helpers for recovery-word count and normalized field values.
 */

/**
 * Identifies which recovery-word grid is being updated.
 */
export type RecoveryWordKind = "generated" | "import";

/**
 * Shows exactly the active recovery-word count and keeps the import toggle honest.
 */
export const setRecoveryWordCount = (
  form: HTMLFormElement,
  inputs: readonly HTMLInputElement[],
  count: 12 | 24,
  kind: RecoveryWordKind,
): void => {
  for (const [index, input] of inputs.entries()) input.hidden = index >= count;
  if (kind !== "import") return;
  const toggle = form.querySelector<HTMLButtonElement>("#phrase-length-toggle");
  if (toggle) {
    toggle.textContent = count === 12 ? "Use a 24-word phrase" : "Use a 12-word phrase";
  }
};

/**
 * Reads and normalizes visible recovery words without validating them locally.
 */
export const recoveryWordsFrom = (
  inputs: readonly HTMLInputElement[],
  count: number,
): readonly string[] => inputs.slice(0, count).map((input) => input.value.trim().toLowerCase());

/**
 * Populates generated or pasted recovery fields and returns their active count.
 */
export const fillRecoveryWords = (
  form: HTMLFormElement,
  inputs: readonly HTMLInputElement[],
  words: readonly string[],
  kind: RecoveryWordKind,
): 12 | 24 => {
  const count = words.length > 12 ? 24 : 12;
  setRecoveryWordCount(form, inputs, count, kind);
  for (const [index, input] of inputs.entries()) {
    input.value = (words[index] ?? "").trim().toLowerCase();
  }
  return count;
};

/**
 * Masks or reveals the generated recovery grid: masked words are hidden from
 * the accessibility tree and untabbable so a shoulder-surfed or screen-read
 * phrase requires the deliberate reveal action.
 */
export const setGeneratedPhraseMasked = (
  grid: HTMLElement | null,
  inputs: readonly HTMLInputElement[],
  masked: boolean,
): void => {
  grid?.classList.toggle("is-masked", masked);
  grid?.toggleAttribute("inert", masked);
  if (masked) {
    grid?.setAttribute("aria-hidden", "true");
  } else {
    grid?.removeAttribute("aria-hidden");
  }
  for (const input of inputs) {
    input.tabIndex = masked ? -1 : 0;
  }
};

/**
 * Shared word-entry wiring for a recovery grid: pasting a complete 12/24-word
 * phrase into any cell distributes it across the grid (via `fillWords`, which
 * also adjusts the active word count), space advances to the next cell,
 * backspace on an empty cell steps back, `clear` empties every cell (keeping
 * the word count), and every change reports through
 * `onChange` after an optional `onBeforeChange` (used to invalidate in-flight
 * validation). Used by first-run recovery and the in-wallet phrase import so
 * the two grids behave identically.
 */
export const bindRecoveryWordEntry = (deps: {
  readonly clear?: HTMLButtonElement | null;
  readonly fillWords: (words: readonly string[]) => void;
  readonly inputs: readonly HTMLInputElement[];
  readonly onBeforeChange?: () => void;
  readonly onChange: () => void;
}): void => {
  const { clear, fillWords, inputs, onBeforeChange, onChange } = deps;
  clear?.addEventListener("click", () => {
    onBeforeChange?.();
    for (const input of inputs) input.value = "";
    onChange();
    inputs[0]?.focus();
  });
  for (const [index, input] of inputs.entries()) {
    input.addEventListener("input", () => {
      onBeforeChange?.();
      const pastedWords = input.value.trim().split(/\s+/).filter(Boolean);
      if (pastedWords.length === 12 || pastedWords.length === 24) {
        fillWords(pastedWords);
      }
      onChange();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === " " && input.value.trim().length > 0) {
        event.preventDefault();
        inputs[index + 1]?.focus();
      } else if (event.key === "Backspace" && input.value.length === 0) {
        inputs[index - 1]?.focus();
      }
    });
    input.addEventListener("paste", (event) => {
      onBeforeChange?.();
      const words = event.clipboardData?.getData("text").trim().split(/\s+/).filter(Boolean) ?? [];
      if (words.length !== 12 && words.length !== 24) {
        return;
      }
      event.preventDefault();
      fillWords(words);
      onChange();
    });
  }
};
