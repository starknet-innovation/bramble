/**
 * First-run "Set up with a Ledger" binder. Kept apart from the create-wallet
 * onboarding binder (and colocated with the rest of the Ledger UI) because it is
 * a distinct concern: it generates no recovery phrase and holds no seed, only a
 * transient unlock passphrase it hands straight to its owner. The owner opens the
 * device onboarding overlay (see ./onboard-entry) with the captured network and
 * passphrase; this module never touches the device or the vault directly.
 */

import { isVaultPassphrase } from "../../storage/encrypted-store";
import { showToast } from "../dom";
import { MAINNET_NETWORK_ID, mainnetAckSatisfied, requiresMainnetAck } from "../mainnet-ack";

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
  const networkSelect = form?.querySelector<HTMLSelectElement>('select[name="ledgerNetworkId"]');
  const ackContainer = form?.querySelector<HTMLElement>("#ledger-mainnet-ack");
  const ackCheckbox = form?.querySelector<HTMLInputElement>('input[name="ledgerMainnetAck"]');
  const button = form?.querySelector<HTMLButtonElement>("#ledger-setup-button");
  const result = form?.querySelector<HTMLElement>("#ledger-passphrase-result");
  const initiallyReady = !(button?.disabled ?? true);

  const selectedNetworkId = (): string => networkSelect?.value ?? MAINNET_NETWORK_ID;
  const passphraseOk = (): boolean => isVaultPassphrase(passphraseInput?.value ?? "");
  const ackOk = (): boolean =>
    mainnetAckSatisfied(selectedNetworkId(), ackCheckbox?.checked ?? false);

  const refreshGate = (): void => {
    if (button) {
      button.disabled = !(initiallyReady && passphraseOk() && ackOk());
    }
    if (result) {
      const value = passphraseInput?.value ?? "";
      result.textContent =
        value.length > 0 && !isVaultPassphrase(value)
          ? "Passphrase must be at least 12 characters."
          : "";
    }
  };

  const syncNetworkGate = (): void => {
    if (ackContainer) {
      if (requiresMainnetAck(selectedNetworkId())) {
        ackContainer.removeAttribute("hidden");
      } else {
        ackContainer.setAttribute("hidden", "");
      }
    }
    refreshGate();
  };

  passphraseInput?.addEventListener("input", refreshGate);
  networkSelect?.addEventListener("change", syncNetworkGate);
  ackCheckbox?.addEventListener("change", refreshGate);
  syncNetworkGate();

  button?.addEventListener("click", () => {
    if (!passphraseOk()) {
      showToast("Passphrase must be at least 12 characters", "error");
      return;
    }
    if (!ackOk()) {
      showToast("Acknowledge the real-funds warning first", "error");
      return;
    }
    deps.startLedgerSetup(selectedNetworkId(), passphraseInput?.value ?? "");
  });
};
