/**
 * Locked-gate binder that forwards the vault passphrase directly to the
 * privileged background and never persists or renders it.
 */
import { buttonBusy, errorDetails, errorLine, showRefusalToast, showToast } from "../../shared/dom";
import type { OnboardingUiDeps } from "./onboarding-ui";

// The background's refusal for a passphrase that does not open the vault.
const WRONG_PASSPHRASE = "Incorrect passphrase";

/**
 * Binds the unlock form on the locked gate screen: submits the passphrase,
 * lands on Home on success, and surfaces failures inline plus as a toast. On
 * the recovery gate (`data-unlock="unverified"`) the same form sends "Unlock
 * anyway", which the background refuses for a vault that verifies.
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
    const unlock =
      form.dataset["unlock"] === "unverified"
        ? deps.wallet.unlockUnverifiedVault(vaultPassphrase)
        : deps.wallet.unlockVault(vaultPassphrase);
    void unlock.then(
      async (status) => {
        onUnlocked();
        showToast("Vault unlocked", "success", form);
        await deps.render(status);
      },
      (error: unknown) => {
        // A wrong passphrase is the user's own mistake, not a diagnostic, so
        // its toast carries no copy control (QA C2).
        if (errorDetails(error, "Unlock failed") === WRONG_PASSPHRASE) {
          showRefusalToast(WRONG_PASSPHRASE, form);
        } else {
          showToast(errorDetails(error, "Unlock failed"), "error", form);
        }
        if (result) {
          result.textContent = errorLine(error, "Unlock failed");
        }
        buttonBusy(submitButton, false);
      },
    );
  });
};
