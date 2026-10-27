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
import { onNetworkChange } from "../../shared/network-change";
import { mountReadyKeyPicker } from "./ready-key-picker";
import { type ReadyKeyInputs, readyKeySession } from "./ready-key-session";

/** Dependencies the key-import binding closes over. */
export type KeyImportUiDeps = {
  /** The long-lived root a network change is announced on. */
  readonly app: Element | null;
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
  const salt = (): string | undefined => {
    const value = saltInput?.value.trim() ?? "";
    return contractSelect?.value === "argent" && value.length > 0 ? value : undefined;
  };
  const inputs = (): ReadyKeyInputs => ({
    key: rawInput?.value.trim() ?? "",
    networkId: deps.networkId(),
    salt: salt(),
  });
  const session = readyKeySession(inputs);

  const refreshGate = (): void => {
    if (continueButton) {
      continueButton.disabled =
        (rawInput?.value.trim() ?? "").length === 0 || session.picked()?.length === 0;
    }
  };
  // A changed key, salt, or account type makes the listed accounts stale, and
  // drops any list still on its way.
  const dropPicker = (): void => {
    session.invalidate();
    buttonBusy(continueButton, false);
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
  // A list is for one network: a switch drops it and any answer still coming.
  onNetworkChange(deps.app, form, dropPicker);
  rawInput?.addEventListener("input", dropPicker);
  saltInput?.addEventListener("input", dropPicker);
  continueButton?.addEventListener("click", () => {
    if (continueButton.disabled) {
      return;
    }
    if (contractSelect?.value !== "argent" || session.matches()) {
      deps.showStep("password");
      return;
    }
    buttonBusy(continueButton, true);
    void session
      .discover(
        (snapshot) =>
          wallet.discoverReadyKeyAccounts(snapshot.networkId, snapshot.key, snapshot.salt),
        (candidates) => {
          if (!result) return null;
          result.textContent = "";
          return mountReadyKeyPicker(result, candidates, new Set(), refreshGate);
        },
      )
      .then(
        (outcome) => {
          if (outcome === "superseded") return;
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
    // Only ticks made for exactly this key, salt, and network are sent; a list
    // built for other inputs is dropped and the user lists the accounts again.
    const selection = contract === "argent" ? session.selection() : null;
    if (contract === "argent") {
      if (selection === null) {
        dropPicker();
        deps.showStep("import-key");
      }
      if (selection === null || selection.classHashes.length === 0) {
        showToast("Choose the accounts to import", "error", form);
        return;
      }
    }
    const sent = selection?.inputs ?? { key: rawKey, networkId: deps.networkId(), salt: salt() };
    buttonBusy(deps.passwordContinue, true);
    try {
      await wallet.createKeyVault(
        sent.networkId,
        sent.key,
        deps.passphrase(),
        contract,
        sent.salt,
        selection?.classHashes,
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
