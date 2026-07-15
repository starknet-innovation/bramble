/**
 * Binding for the raw-private-key import form on the account flow. Isolated
 * because it reads secret key material from the form: the private key is passed
 * straight to the privileged background import request (which routes it to the
 * encrypted vault) and is never logged, echoed, or stored in preferences.
 */
import { buttonBusy, errorMessage, showToast } from "./dom";
import type { SettingsUiDeps } from "./settings-ui";

/**
 * Binds the "Import private key" form: on submit, sends the pasted key to the
 * background import flow, then re-renders on success. Invalid keys, duplicates,
 * and a locked wallet surface as a status message without adding an account.
 */
export const bindImportKey = (deps: SettingsUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#import-key-form");
  const result = deps.app?.querySelector<HTMLElement>("#import-key-result");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const privateKey = String(new FormData(form).get("rawKey") ?? "").trim();
    if (!privateKey) {
      if (result) {
        result.textContent = "Enter a private key to import";
      }
      return;
    }

    buttonBusy(submitButton, true);
    void deps.wallet.importAccount(deps.networkId(), privateKey).then(
      async () => {
        form.reset();
        showToast("Account imported", "success");
        await deps.render(await deps.refresh());
      },
      (error: unknown) => {
        const message = errorMessage(error, "Import failed");
        showToast(message, "error");
        if (result) {
          result.textContent = message;
        }
        buttonBusy(submitButton, false);
      },
    );
  });
};
