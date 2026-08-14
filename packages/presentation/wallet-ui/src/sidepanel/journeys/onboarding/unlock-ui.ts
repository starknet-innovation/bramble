/**
 * Locked-gate binder that forwards the vault passphrase directly to the
 * privileged background and never persists or renders it.
 */
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import type { OnboardingUiDeps } from "./onboarding-ui";

/**
 * Binds the unlock form on the locked gate screen: submits the passphrase,
 * lands on Home on success, and surfaces failures inline plus as a toast.
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
    void deps.wallet.unlockVault(vaultPassphrase).then(
      async (status) => {
        onUnlocked();
        showToast("Vault unlocked", "success");
        await deps.render(status);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Unlock failed"), "error");
        if (result) {
          result.textContent = errorMessage(error, "Unlock failed");
        }
        buttonBusy(submitButton, false);
      },
    );
  });
};
