/**
 * Locked-gate binder that forwards the vault passphrase directly to the
 * privileged background and never persists or renders it.
 */
import { buttonBusy, errorLine, errorMessage, showToast } from "../../shared/dom";
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
        showToast("Vault unlocked", "success", form);
        await deps.render(status);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Unlock failed"), "error", form);
        if (result) {
          result.textContent = errorLine(error, "Unlock failed");
        }
        buttonBusy(submitButton, false);
      },
    );
  });
};

/**
 * Binds the locked gate's reinitialize affordance: sends the privileged reset
 * and then re-renders, so the resulting vault-less status lands on first-run
 * onboarding. The wallet is untouched while the request is in flight; a failure
 * stays inline and leaves the user on the unlock screen.
 */
export const bindVaultReset = (deps: OnboardingUiDeps): void => {
  const details = deps.app?.querySelector<HTMLDetailsElement>("#unlock-more");
  const panel = details?.querySelector<HTMLElement>(".gate-more-panel");
  const confirmButton = panel?.querySelector<HTMLButtonElement>("button");
  const result = panel?.querySelector<HTMLElement>("#reset-result");
  if (!confirmButton) {
    return;
  }
  confirmButton.addEventListener("click", () => {
    buttonBusy(confirmButton, true);
    void deps.wallet.resetVault().then(
      async () => {
        await deps.render(await deps.wallet.loadStatus());
      },
      (error: unknown) => {
        if (result) {
          result.textContent = errorLine(error, "Reinitialize failed");
        }
        buttonBusy(confirmButton, false);
      },
    );
  });
};
