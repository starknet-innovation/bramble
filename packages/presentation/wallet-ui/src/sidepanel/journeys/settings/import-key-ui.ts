/**
 * Binding for the raw-private-key import form on the account flow. Isolated
 * because it reads secret key material from the form: the private key is passed
 * straight to the privileged background import request (which routes it to the
 * encrypted vault) and is never logged, echoed, or stored in preferences.
 */
import { isStarkCurveContractType } from "@mc-wallet/wallet-model/accounts";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
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
  const accountContractSelect = form?.querySelector<HTMLSelectElement>(
    'select[name="accountContractType"]',
  );
  const deploymentSaltInput = form?.querySelector<HTMLInputElement>('input[name="deploymentSalt"]');

  const syncDeploymentSalt = (): void => {
    if (!deploymentSaltInput) return;
    const acceptsSalt = accountContractSelect?.value === "argent";
    if (!acceptsSalt) deploymentSaltInput.value = "";
    deploymentSaltInput.disabled = !acceptsSalt;
  };

  accountContractSelect?.addEventListener("change", syncDeploymentSalt);
  syncDeploymentSalt();

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const privateKey = String(data.get("rawKey") ?? "").trim();
    const accountContractType = data.get("accountContractType");
    if (!privateKey || !isStarkCurveContractType(accountContractType)) {
      if (result) {
        result.textContent = privateKey
          ? "Choose a supported account contract"
          : "Enter a private key to import";
      }
      return;
    }
    const deploymentSalt =
      accountContractType === "argent"
        ? String(data.get("deploymentSalt") ?? "").trim() || undefined
        : undefined;

    buttonBusy(submitButton, true);
    void deps.wallet
      .importAccount(deps.networkId(), privateKey, accountContractType, deploymentSalt)
      .then(
        async () => {
          form.reset();
          showToast("Account imported", "success", form);
          await deps.render(await deps.refresh());
        },
        (error: unknown) => {
          const message = errorMessage(error, "Import failed");
          showToast(message, "error", form);
          if (result) {
            result.textContent = message;
          }
          buttonBusy(submitButton, false);
        },
      );
  });
};
