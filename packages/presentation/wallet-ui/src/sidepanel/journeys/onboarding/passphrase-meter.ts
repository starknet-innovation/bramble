/**
 * Vault-credential meter binding shared by the software and Ledger setup
 * flows. The meter is pure feedback: the fill and its colour band follow
 * `estimatePassphraseStrength` as the value is typed, and the line beneath
 * reports the strength hint or, once both fields agree, the match. Enter in
 * either field presses the step's continue control once it is enabled.
 * Acceptance stays with `isVaultPassphrase` in the callers; nothing here
 * keeps the value.
 */
import { isVaultPassphrase } from "@bramble/wallet-model/passphrase";
import { estimatePassphraseStrength } from "@bramble/wallet-model/passphrase-strength";

/**
 * Elements of one `.password-requirement` block: the container that carries
 * the band and fill, and the text line beneath the bar.
 */
export type PassphraseMeter = {
  readonly requirement: HTMLElement | null | undefined;
  readonly result: HTMLElement | null | undefined;
};

/**
 * Updates the meter for the current value and its confirmation. The fill
 * ratio is published as `--meter-fill` and the band as `data-strength` on
 * the container; `is-ready` marks a valid, confirmed value.
 */
export const applyPassphraseMeter = (
  meter: PassphraseMeter,
  entered: string,
  confirmation: string,
): void => {
  const { requirement, result } = meter;
  const strength = estimatePassphraseStrength(entered);
  const valid = isVaultPassphrase(entered);
  const matches = valid && confirmation.length > 0 && entered === confirmation;
  if (requirement) {
    requirement.dataset["strength"] = strength.level;
    requirement.style.setProperty("--meter-fill", String(strength.ratio));
    requirement.classList.toggle("is-ready", matches);
  }
  if (result) {
    result.textContent =
      !valid || confirmation.length === 0
        ? strength.hint
        : matches
          ? `${strength.hint} · Passphrases match`
          : "Passphrases do not match";
  }
};

/**
 * Makes Enter in a passphrase field press the step's continue control, the
 * way it would in a form of its own. The control's own `disabled` state is the
 * only gate, so Enter does nothing until the passphrase is acceptable or while
 * the control is busy; validation stays with the caller's click handler.
 * Always cancels the key, so an enclosing form is never implicitly submitted.
 */
export const bindEnterToContinue = (
  inputs: readonly (HTMLInputElement | null | undefined)[],
  continueButton: HTMLButtonElement | null | undefined,
): void => {
  for (const input of inputs) {
    input?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      if (continueButton && !continueButton.disabled) continueButton.click();
    });
  }
};
