/** Bounded OZ/Argent account discovery and confirmation for phrase recovery. */

import type {
  RecoveryAccountCandidate,
  RecoveryAccountSelection,
} from "@bramble/wallet-model/recovery";
import { isRecoveryAccountIndex, RECOVERY_SCAN_LIMITS } from "@bramble/wallet-model/recovery";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import { accountLabel } from "../../shared/parts";

type RecoveryAccountUiDeps = {
  readonly form: HTMLFormElement;
  readonly mnemonic: () => string;
  readonly networkId: () => string;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly vaultPassphrase: () => string;
  readonly wallet: SidepanelWallet;
};

/** Recovery discovery handle started only after phrase and vault checks pass. */
export type RecoveryAccountUi = {
  readonly start: () => void;
};

const selectionKey = (selection: RecoveryAccountSelection): string =>
  `${selection.accountContractType}:${selection.accountIndex}`;

const selectionFor = (candidate: RecoveryAccountCandidate): RecoveryAccountSelection => ({
  accountContractType: candidate.account.accountContractType,
  accountIndex: candidate.account.derivation.accountIndex,
});

const candidateState = (candidate: RecoveryAccountCandidate): string =>
  candidate.deployed
    ? "Deployed on Starknet"
    : candidate.funded
      ? "Funded and ready to deploy"
      : "No on-chain activity found";

/** Binds and runs the recovery account picker without retaining the phrase. */
export const bindRecoveryAccountUi = (deps: RecoveryAccountUiDeps): RecoveryAccountUi => {
  const list = deps.form.querySelector<HTMLUListElement>("#recovery-account-list");
  const status = deps.form.querySelector<HTMLElement>("#recovery-scan-status");
  const result = deps.form.querySelector<HTMLElement>("#recovery-accounts-result");
  const retry = deps.form.querySelector<HTMLButtonElement>("#recovery-scan-retry");
  const restore = deps.form.querySelector<HTMLButtonElement>("#recover-accounts-button");
  const manual = deps.form.querySelector<HTMLInputElement>('input[name="recoveryManualIndex"]');
  const manualSearch = deps.form.querySelector<HTMLButtonElement>("#recovery-manual-search");
  const acknowledgement = deps.form.querySelector<HTMLInputElement>(
    'input[name="recoveryMainnetAck"]',
  );
  let candidates: readonly RecoveryAccountCandidate[] = [];
  let complete = false;
  let generation = 0;
  let restartOnIdle = false;
  let scanning = false;
  const selected = new Set<string>();
  const seen = new Set<string>();

  const refreshGate = (): void => {
    if (restore) restore.disabled = selected.size === 0 || !acknowledgement?.checked;
  };

  const renderCandidates = (): void => {
    list?.replaceChildren();
    for (const candidate of [...candidates].sort(
      (left, right) =>
        left.account.derivation.accountIndex - right.account.derivation.accountIndex ||
        right.account.accountContractType.localeCompare(left.account.accountContractType),
    )) {
      const selection = selectionFor(candidate);
      const key = selectionKey(selection);
      const row = deps.form.ownerDocument.createElement("li");
      row.className = "allowance-row";
      const label = deps.form.ownerDocument.createElement("label");
      label.className = "select-row";
      const checkbox = deps.form.ownerDocument.createElement("input");
      checkbox.className = "select-check";
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(key);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(key);
        else selected.delete(key);
        refreshGate();
      });
      const copy = deps.form.ownerDocument.createElement("span");
      copy.className = "allowance-copy";
      const title = deps.form.ownerDocument.createElement("strong");
      title.textContent = `${candidate.account.accountContractType === "argent" ? "Argent" : "OpenZeppelin"} account ${selection.accountIndex}`;
      const address = deps.form.ownerDocument.createElement("code");
      address.textContent = accountLabel(candidate.account.address);
      address.title = candidate.account.address;
      const hint = deps.form.ownerDocument.createElement("span");
      hint.className = "hint";
      hint.textContent = candidateState(candidate);
      copy.append(title, address, hint);
      label.append(checkbox, copy);
      row.append(label);
      list?.append(row);
    }
    refreshGate();
  };

  const apply = (next: Awaited<ReturnType<SidepanelWallet["discoverRecoveryAccounts"]>>): void => {
    for (const candidate of next.candidates) {
      const key = selectionKey(selectionFor(candidate));
      if (!seen.has(key) && (candidate.deployed || candidate.funded)) selected.add(key);
      seen.add(key);
    }
    candidates = next.candidates;
    complete = next.complete;
    renderCandidates();
    if (status) {
      status.textContent = complete
        ? `Search complete. Checked ${next.nextIndex} indices across both account types.`
        : `Checked ${next.nextIndex} of ${RECOVERY_SCAN_LIMITS.defaultCount} indices…`;
    }
  };

  const scan = async (manualIndex?: number): Promise<void> => {
    if (scanning) return;
    scanning = true;
    const activeGeneration = generation;
    const activeButton = manualIndex === undefined ? retry : manualSearch;
    const inactiveButton = manualIndex === undefined ? manualSearch : retry;
    buttonBusy(activeButton, true);
    if (inactiveButton) inactiveButton.disabled = true;
    try {
      let next: Awaited<ReturnType<SidepanelWallet["discoverRecoveryAccounts"]>>;
      do {
        next = await deps.wallet.discoverRecoveryAccounts(
          deps.mnemonic(),
          deps.networkId(),
          manualIndex,
        );
        if (generation !== activeGeneration) return;
        apply(next);
      } while (manualIndex === undefined && !next.complete);
    } catch (error) {
      if (generation !== activeGeneration) return;
      const message = errorMessage(error, "Account search paused. Check the network and retry.");
      if (status) status.textContent = message;
      showToast(message, "error", list);
    } finally {
      scanning = false;
      buttonBusy(activeButton, false);
      if (inactiveButton) inactiveButton.disabled = false;
      if (restartOnIdle) {
        restartOnIdle = false;
        void scan();
      }
    }
  };

  const stop = (): void => {
    generation += 1;
    restartOnIdle = false;
  };

  retry?.addEventListener("click", () => void scan());
  deps.form
    .querySelector('[data-onboarding-step="recovery-accounts"] [data-onboarding-back]')
    ?.addEventListener("click", stop);
  manualSearch?.addEventListener("click", () => {
    const index = Number(manual?.value);
    if (!manual?.value || !isRecoveryAccountIndex(index)) {
      showToast("Enter a valid non-negative account index", "error", manualSearch);
      return;
    }
    void scan(index);
  });
  acknowledgement?.addEventListener("change", refreshGate);
  restore?.addEventListener("click", () => {
    const selections = candidates
      .map(selectionFor)
      .filter((selection) => selected.has(selectionKey(selection)));
    if (selections.length === 0 || !acknowledgement?.checked) return;
    buttonBusy(restore, true);
    if (result) result.textContent = "Restoring the selected accounts into your encrypted vault…";
    void deps.wallet
      .recoverAccounts(deps.mnemonic(), deps.networkId(), deps.vaultPassphrase(), selections)
      .then(async (accounts) => {
        showToast(
          `${accounts.length} account${accounts.length === 1 ? "" : "s"} restored`,
          "success",
          restore,
        );
        await deps.render(await deps.wallet.loadStatus());
      })
      .catch((error: unknown) => {
        const message = errorMessage(error, "Account recovery failed");
        if (result) result.textContent = message;
        showToast(message, "error", restore);
        buttonBusy(restore, false);
      });
  });

  return {
    start() {
      generation += 1;
      candidates = [];
      complete = false;
      selected.clear();
      seen.clear();
      if (acknowledgement) acknowledgement.checked = false;
      if (status) status.textContent = "Searching both account types…";
      if (result) result.textContent = "";
      renderCandidates();
      if (scanning) restartOnIdle = true;
      else void scan();
    },
  };
};
