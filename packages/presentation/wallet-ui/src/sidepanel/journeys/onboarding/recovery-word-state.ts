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
