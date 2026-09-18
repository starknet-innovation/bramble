/**
 * First-run "Set up with a Ledger" binder. Kept apart from the create-wallet
 * onboarding binder (and colocated with the rest of the Ledger UI) because it is
 * a distinct concern: it generates no recovery phrase and holds no seed, only a
 * transient unlock passphrase it hands straight to its owner. The owner opens the
 * device onboarding overlay (see ./onboard-entry) with the captured network and
 * passphrase; this module never touches the device or the vault directly.
 */

import { isVaultPassphrase, MIN_VAULT_PASSPHRASE_LENGTH } from "@bramble/wallet-model/passphrase";
import { showToast } from "../../shared/dom";
import { MAINNET_NETWORK_ID, mainnetAckSatisfied } from "../onboarding/mainnet-ack";
import { applyPassphraseMeter } from "../onboarding/passphrase-meter";

/**
 * Dependencies the first-run Ledger setup binding closes over. `startLedgerSetup`
 * hands the captured network + unlock passphrase to the owner (which opens the
 * device onboarding overlay); no key material is generated here.
 */
export type LedgerFirstRunDeps = {
  readonly app: Element | null;
  readonly startLedgerSetup: (networkId: string, vaultPassphrase: string) => void;
};

/**
 * Binds the first-run "Set up with a Ledger" card: gates the button on a valid
 * unlock passphrase and, on Mainnet, the real-funds acknowledgement, then hands
 * the network and passphrase to the owner to drive the device onboarding overlay.
 * No recovery phrase is generated or requested — the vault holds no seed.
 */
export const bindLedgerFirstRun = (deps: LedgerFirstRunDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#ledger-setup-form");
  const passphraseInput = form?.querySelector<HTMLInputElement>(
    'input[name="ledgerVaultPassphrase"]',
  );
  const confirmationInput = form?.querySelector<HTMLInputElement>(
    'input[name="ledgerVaultPassphraseConfirm"]',
  );
  const passwordResult = form?.querySelector<HTMLElement>("[data-password-result]");
  const passwordRequirement = passwordResult?.closest<HTMLElement>(".password-requirement");
  const ackCheckbox = form?.querySelector<HTMLInputElement>('input[name="ledgerMainnetAck"]');
  const button = form?.querySelector<HTMLButtonElement>("#ledger-setup-button");
  const result = form?.querySelector<HTMLElement>("#ledger-passphrase-result");
  const initiallyReady = !(button?.disabled ?? true);

  const passphraseOk = (): boolean => {
    const value = passphraseInput?.value ?? "";
    return isVaultPassphrase(value) && value === (confirmationInput?.value ?? "");
  };
  const ackOk = (): boolean =>
    mainnetAckSatisfied(MAINNET_NETWORK_ID, ackCheckbox?.checked ?? false);

  const refreshGate = (): void => {
    if (button) {
      button.disabled = !(initiallyReady && passphraseOk() && ackOk());
    }
    if (result) {
      const value = passphraseInput?.value ?? "";
      const confirmation = confirmationInput?.value ?? "";
      const valueLength = value.length;
      const passphraseValid = isVaultPassphrase(value);
      result.textContent = !passphraseValid
        ? valueLength > 0
          ? `Passphrase must be at least ${MIN_VAULT_PASSPHRASE_LENGTH} characters.`
          : ""
        : confirmation.length > 0 && value !== confirmation
          ? "Enter the same passphrase in both fields."
          : "";
    }
    applyPassphraseMeter(
      { requirement: passwordRequirement, result: passwordResult },
      passphraseInput?.value ?? "",
      confirmationInput?.value ?? "",
    );
  };

  passphraseInput?.addEventListener("input", refreshGate);
  confirmationInput?.addEventListener("input", refreshGate);
  ackCheckbox?.addEventListener("change", refreshGate);
  refreshGate();

  button?.addEventListener("click", () => {
    if (!passphraseOk()) {
      showToast(
        `Passphrase must be at least ${MIN_VAULT_PASSPHRASE_LENGTH} characters`,
        "error",
        form,
      );
      return;
    }
    if (!ackOk()) {
      showToast("Acknowledge the real-funds warning first", "error", form);
      return;
    }
    deps.startLedgerSetup(MAINNET_NETWORK_ID, passphraseInput?.value ?? "");
  });
};
