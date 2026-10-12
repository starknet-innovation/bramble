/**
 * First-run private-key import binding: the "Private key" route of the
 * "Add an existing wallet" method screen. The raw key lives only in its form
 * field until the single privileged `createKeyVault` request; nothing here
 * logs, stores, or echoes it, and failures surface as toast + status text.
 */

import { isCreatableAccountContractType } from "@bramble/wallet-model/accounts";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorDetails, errorMessage, showToast } from "../../shared/dom";

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

  const refreshGate = (): void => {
    if (continueButton) {
      continueButton.disabled = (rawInput?.value.trim() ?? "").length === 0;
    }
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
  contractSelect?.addEventListener("change", syncSaltField);
  syncSaltField();
  rawInput?.addEventListener("input", refreshGate);
  continueButton?.addEventListener("click", () => {
    if (continueButton.disabled) {
      return;
    }
    deps.showStep("password");
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
    const salt = saltInput?.value.trim() ?? "";
    buttonBusy(deps.passwordContinue, true);
    try {
      await wallet.createKeyVault(
        deps.networkId(),
        rawKey,
        deps.passphrase(),
        contract,
        contract === "argent" && salt.length > 0 ? salt : undefined,
      );
      showToast("Wallet created", "success", form);
      await deps.render(await wallet.loadStatus());
    } catch (error) {
      const message = errorMessage(error, "Account import failed");
      showToast(message, "error", form, errorDetails(error, "Account import failed"));
      if (result) {
        result.textContent = message;
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
