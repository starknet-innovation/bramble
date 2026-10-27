/**
 * Binding for the raw-private-key import form on the account flow. Isolated
 * because it reads secret key material from the form: the private key is passed
 * straight to the privileged background requests (which route it to the
 * encrypted vault) and is never logged, echoed, or stored in preferences.
 *
 * A "Ready Account" key first lists the Argent releases it controls an address
 * in use at, and imports only the ones the user ticks (issue 776).
 */
import { isCreatableAccountContractType } from "@bramble/wallet-model/accounts";
import { buttonBusy, errorDetails, errorLine, showToast } from "../../shared/dom";
import { mountReadyKeyPicker, type ReadyKeyPicker } from "../onboarding/ready-key-picker";
import type { SettingsUiDeps } from "./settings-ui";

const IMPORT_LABEL = "Import account";
const IMPORT_PICKED_LABEL = "Import selected";

/**
 * Binds the "Import private key" form: on submit, sends the pasted key to the
 * background import flow, then resets the form and re-renders on success. A
 * Ready key takes two submits: one to list its accounts, one to import the
 * ticked ones. Invalid keys, duplicates, and a locked wallet surface as a
 * status message without adding an account.
 */
export const bindImportKey = (deps: SettingsUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#import-key-form");
  const result = deps.app?.querySelector<HTMLElement>("#import-key-result");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const accountContractSelect = form?.querySelector<HTMLSelectElement>(
    'select[name="accountContractType"]',
  );
  const deploymentSaltInput = form?.querySelector<HTMLInputElement>('input[name="deploymentSalt"]');
  let picker: ReadyKeyPicker | null = null;

  const setLabel = (label: string): void => {
    submitButton?.lastChild?.replaceWith(label);
  };
  const refreshGate = (): void => {
    if (submitButton && picker) submitButton.disabled = picker.picked().length === 0;
  };
  // A changed key, salt, or account type makes the listed accounts stale.
  const dropPicker = (): void => {
    picker?.remove();
    picker = null;
    setLabel(IMPORT_LABEL);
    if (submitButton) submitButton.disabled = false;
  };

  const syncDeploymentSalt = (): void => {
    if (!deploymentSaltInput) return;
    const acceptsSalt = accountContractSelect?.value === "argent";
    if (!acceptsSalt) deploymentSaltInput.value = "";
    deploymentSaltInput.disabled = !acceptsSalt;
  };

  accountContractSelect?.addEventListener("change", () => {
    syncDeploymentSalt();
    dropPicker();
  });
  syncDeploymentSalt();
  form?.querySelector('textarea[name="rawKey"]')?.addEventListener("input", dropPicker);
  deploymentSaltInput?.addEventListener("input", dropPicker);

  const fail = (error: unknown): void => {
    showToast(errorDetails(error, "Import failed"), "error", form);
    if (result) result.textContent = errorLine(error, "Import failed");
    buttonBusy(submitButton, false);
    refreshGate();
  };

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const privateKey = String(data.get("rawKey") ?? "").trim();
    const accountContractType = data.get("accountContractType");
    if (!privateKey || !isCreatableAccountContractType(accountContractType)) {
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
    if (accountContractType === "argent" && picker === null) {
      void deps.wallet
        .discoverReadyKeyAccounts(deps.networkId(), privateKey, deploymentSalt)
        .then((candidates) => {
          const before = submitButton ?? result;
          if (before) {
            picker = mountReadyKeyPicker(
              before,
              candidates,
              deps.existingAccountIds?.() ?? new Set(),
              refreshGate,
            );
          }
          if (result) result.textContent = "";
          buttonBusy(submitButton, false);
          setLabel(IMPORT_PICKED_LABEL);
          refreshGate();
        }, fail);
      return;
    }
    const picked = picker?.picked();
    if (picked !== undefined && picked.length === 0) {
      buttonBusy(submitButton, false);
      refreshGate();
      return;
    }
    void deps.wallet
      .importAccount(deps.networkId(), privateKey, accountContractType, deploymentSalt, picked)
      .then(async () => {
        // The paint loop skips the repaint when the flow's markup is
        // unchanged, so the form must not rely on it to leave the busy state
        // or drop an earlier attempt's error.
        form.reset();
        dropPicker();
        buttonBusy(submitButton, false);
        if (result) {
          result.textContent = "";
        }
        const count = picked?.length ?? 1;
        showToast(count > 1 ? `${count} accounts imported` : "Account imported", "success", form);
        await deps.render(await deps.refresh());
      }, fail);
  });
};
