/**
 * "Save your recovery phrase" step: the deliberate reveal and what it unlocks.
 * The words stay masked — out of the accessibility tree and untabbable — until
 * the user asks to see them. Revealing them once enables "I saved my phrase"
 * and the guarded clipboard copy, which is the Reveal screen's own copy
 * (../../shared/guarded-copy.ts): same warning beside it, same best-effort
 * clear a minute later.
 *
 * The words live only in the caller's closure. This module reads them at click
 * time through `readPhrase` and never keeps, renders, or attributes a second
 * copy of its own.
 */
import { bindGuardedCopy } from "../../shared/guarded-copy";
import { setGeneratedPhraseMasked } from "./recovery-word-state";

/**
 * Controls the onboarding binding keeps for a freshly generated phrase.
 */
export type GeneratedPhraseControls = {
  /** Masks a newly generated phrase again and locks what the reveal unlocks. */
  readonly reset: () => void;
};

/**
 * Binds the reveal toggle, "I saved my phrase", and the guarded copy on the
 * generated-phrase step of `form`. Missing controls are skipped. `readPhrase`
 * returns the current words; the copy refuses until they have been revealed.
 */
export const bindGeneratedPhrase = (
  form: HTMLFormElement,
  readPhrase: () => string,
): GeneratedPhraseControls => {
  const grid = form.querySelector<HTMLElement>('[data-recovery-grid="generated"]');
  const inputs = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[data-recovery-kind="generated"]'),
  );
  const toggle = form.querySelector<HTMLButtonElement>("#phrase-toggle");
  const copy = form.querySelector<HTMLButtonElement>("#generated-copy-phrase");
  const unlocked = [form.querySelector<HTMLButtonElement>("#generated-continue"), copy];
  let revealed = false;

  const syncUnlocked = (): void => {
    for (const control of unlocked) {
      if (control) {
        control.disabled = !revealed;
      }
    }
  };

  toggle?.addEventListener("click", () => {
    const masked = !(grid?.classList.contains("is-masked") ?? false);
    setGeneratedPhraseMasked(grid, inputs, masked);
    toggle.lastChild?.replaceWith(masked ? "Show" : "Hide");
    toggle.setAttribute("aria-label", `${masked ? "Show" : "Hide"} recovery phrase`);
    revealed ||= !masked;
    syncUnlocked();
  });
  bindGuardedCopy(copy, () => (revealed ? readPhrase() : ""));

  return {
    reset: () => {
      revealed = false;
      setGeneratedPhraseMasked(grid, inputs, true);
      toggle?.lastChild?.replaceWith("Show");
      toggle?.setAttribute("aria-label", "Show recovery phrase");
      syncUnlocked();
    },
  };
};
