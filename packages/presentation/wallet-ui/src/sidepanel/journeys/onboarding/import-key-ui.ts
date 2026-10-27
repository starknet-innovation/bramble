/**
 * First-run private-key import binding: the "Private key" route of the
 * "Add an existing wallet" method screen. The raw key lives only in its form
 * field until the single privileged `createKeyVault` request; nothing here
 * logs, stores, or echoes it, and failures surface as toast + status text.
 * A "Ready Account" key first lists the Argent releases it controls an address
 * in use at; the user ticks which to import before choosing a passphrase.
 */

import { isCreatableAccountContractType } from "@bramble/wallet-model/accounts";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorDetails, errorLine, errorMessage, showToast } from "../../shared/dom";
import { mountReadyKeyPicker, type ReadyKeyPicker } from "./ready-key-picker";

/** Dependencies the key-import binding closes over. */
export type KeyImportUiDeps = {
  readonly form: HTMLFormElement;
  readonly networkId: () => string;
  readonly onEnter: () => void;
  readonly passphrase: () => string;
  readonly passwordContinue: HTMLButtonElement | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly showStep: (id: string) => void;
  readonly wallet: SidepanelWallet;
};

/**
 * The handle the staged onboarding binder drives: `active()` gates the shared
 * password CTA into key-vault creation, `deactivate()` returns the CTA to the
 * phrase flows, and `runCreate()` performs the fail-closed creation request.
 */
export type KeyImportBinding = {
  readonly active: () => boolean;
  readonly deactivate: () => void;
  readonly runCreate: () => Promise<void>;
};

/**
 * Binds the import-key step: gates Continue on a non-empty key and creates the
 * phrase-less vault on the shared password CTA. Never retains key material
 * outside the form field.
 */
export const bindKeyImport = (deps: KeyImportUiDeps): KeyImportBinding => {
  const { form, wallet } = deps;
  const continueButton = form.querySelector<HTMLButtonElement>("#import-key-continue");
  const contractSelect = form.querySelector<HTMLSelectElement>(
    'select[name="importKeyContractType"]',
  );
  const rawInput = form.querySelector<HTMLTextAreaElement>('textarea[name="importKeyRaw"]');
  const saltInput = form.querySelector<HTMLInputElement>('input[name="importKeySalt"]');
  const result = form.querySelector<HTMLElement>("#import-key-result");
  let active = false;
  let picker: ReadyKeyPicker | null = null;

  const refreshGate = (): void => {
    if (continueButton) {
      continueButton.disabled =
        (rawInput?.value.trim() ?? "").length === 0 ||
        (picker !== null && picker.picked().length === 0);
    }
  };
  // A changed key, salt, or account type makes the listed accounts stale.
  const dropPicker = (): void => {
    picker?.remove();
    picker = null;
    refreshGate();
  };

  form.querySelector("#key-method-button")?.addEventListener("click", () => {
    active = true;
    deps.onEnter();
    deps.passwordContinue?.lastChild?.replaceWith("Create wallet");
    refreshGate();
    deps.showStep("import-key");
  });
  // The salt belongs to a Ready account: it is the DEPLOY_ACCOUNT salt that
  // recovers an externally created one. Shown only when that contract is chosen,
  // so the field is not a question the other account type has to read past.
  const saltField = form.querySelector<HTMLElement>("#import-key-salt-field");
  const syncSaltField = (): void => {
    saltField?.toggleAttribute("hidden", contractSelect?.value !== "argent");
  };
  contractSelect?.addEventListener("change", () => {
    syncSaltField();
    dropPicker();
  });
  syncSaltField();
  rawInput?.addEventListener("input", dropPicker);
  saltInput?.addEventListener("input", dropPicker);
  const salt = (): string | undefined => {
    const value = saltInput?.value.trim() ?? "";
    return contractSelect?.value === "argent" && value.length > 0 ? value : undefined;
  };
  continueButton?.addEventListener("click", () => {
    if (continueButton.disabled) {
      return;
    }
    if (contractSelect?.value !== "argent" || picker !== null) {
      deps.showStep("password");
      return;
    }
    buttonBusy(continueButton, true);
    void wallet
      .discoverReadyKeyAccounts(deps.networkId(), rawInput?.value.trim() ?? "", salt())
      .then(
        (candidates) => {
          if (result) {
            result.textContent = "";
            picker = mountReadyKeyPicker(result, candidates, new Set(), refreshGate);
          }
          buttonBusy(continueButton, false);
          refreshGate();
        },
        (error: unknown) => {
          showToast(errorDetails(error, "Account import failed"), "error", form);
          if (result) result.textContent = errorLine(error, "Account import failed");
          buttonBusy(continueButton, false);
          refreshGate();
        },
      );
  });

  const runCreate = async (): Promise<void> => {
    const contract = contractSelect?.value;
    if (!isCreatableAccountContractType(contract)) {
      showToast("Choose a supported account contract", "error", form);
      return;
    }
    const rawKey = rawInput?.value.trim() ?? "";
    if (rawKey.length === 0) {
      showToast("Enter the account's private key", "error", form);
      return;
    }
    const picked = contract === "argent" ? picker?.picked() : undefined;
    if (contract === "argent" && (picked === undefined || picked.length === 0)) {
      showToast("Choose the accounts to import", "error", form);
      return;
    }
    buttonBusy(deps.passwordContinue, true);
    try {
      await wallet.createKeyVault(
        deps.networkId(),
        rawKey,
        deps.passphrase(),
        contract,
        salt(),
        picked,
      );
      showToast("Wallet created", "success", form);
      await deps.render(await wallet.loadStatus());
    } catch (error) {
      const message = errorMessage(error, "Account import failed");
      showToast(message, "error", form, errorDetails(error, "Account import failed"));
      if (result) {
        result.textContent = errorLine(error, "Account import failed");
      }
      buttonBusy(deps.passwordContinue, false);
    }
  };

  return {
    active: () => active,
    deactivate() {
      active = false;
    },
    runCreate,
  };
};
