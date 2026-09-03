/** Bounded OZ/Argent account discovery and confirmation for phrase recovery. */

import type {
  RecoveryAccountCandidate,
  RecoveryAccountSelection,
} from "@bramble/wallet-model/recovery";
import { isRecoveryAccountIndex, RECOVERY_SCAN_LIMITS } from "@bramble/wallet-model/recovery";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import { accountLabel, accountsDetectedText } from "../../shared/parts";

type RecoveryAccountUiDeps = {
  /** Accounts already in the vault; scan candidates matching them are shown but locked. */
  readonly existingIds?: () => ReadonlySet<string>;
  readonly form: HTMLFormElement;
  readonly mnemonic: () => string;
  readonly networkId: () => string;
  readonly render: (status: WalletStatus) => Promise<void>;
  /** Overrides first-run `recoverAccounts` — the in-wallet seed import commits here. */
  readonly restore?: (
    mnemonic: string,
    networkId: string,
    selections: readonly RecoveryAccountSelection[],
  ) => Promise<unknown>;
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

const candidateState = (candidate: RecoveryAccountCandidate, duplicate: boolean): string =>
  duplicate
    ? "Already in this wallet"
    : candidate.deployed
      ? "Deployed on Starknet"
      : candidate.funded
        ? "Funded and ready to deploy"
        : candidate.account.accountContractType === "argent"
          ? "No on-chain activity found — Bramble only imports existing Ready accounts"
          : "No on-chain activity found";

// Bramble creates only Bramble accounts: a Ready candidate with no on-chain
// history would be a brand-new Ready deployment, so it is listed but not
// selectable. Deployed or funded (counterfactual) Ready accounts stay
// importable.
const selectable = (candidate: RecoveryAccountCandidate): boolean =>
  candidate.account.accountContractType !== "argent" || candidate.deployed || candidate.funded;

/** Binds and runs the recovery account picker without retaining the phrase. */
export const bindRecoveryAccountUi = (deps: RecoveryAccountUiDeps): RecoveryAccountUi => {
  const groupFor = (contractType: "argent" | "openzeppelin"): HTMLDetailsElement | null =>
    deps.form.querySelector<HTMLDetailsElement>(`[data-recovery-group="${contractType}"]`);
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

  const candidateRow = (candidate: RecoveryAccountCandidate): HTMLLIElement => {
    const key = selectionKey(selectionFor(candidate));
    const duplicate = deps.existingIds?.().has(candidate.account.id) ?? false;
    const row = deps.form.ownerDocument.createElement("li");
    row.className = "allowance-row";
    const label = deps.form.ownerDocument.createElement("label");
    label.className = "select-row";
    const checkbox = deps.form.ownerDocument.createElement("input");
    checkbox.className = "select-check";
    checkbox.type = "checkbox";
    checkbox.disabled = duplicate || !selectable(candidate);
    checkbox.checked = !duplicate && selected.has(key);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selected.add(key);
      else selected.delete(key);
      refreshGate();
    });
    const copy = deps.form.ownerDocument.createElement("span");
    copy.className = "allowance-copy";
    const title = deps.form.ownerDocument.createElement("strong");
    title.textContent = `Account ${candidate.account.derivation.accountIndex}`;
    const address = deps.form.ownerDocument.createElement("code");
    address.textContent = accountLabel(candidate.account.address);
    address.title = candidate.account.address;
    const hint = deps.form.ownerDocument.createElement("span");
    hint.className = "hint";
    hint.textContent = candidateState(candidate, duplicate);
    copy.append(title, address, hint);
    label.append(checkbox, copy);
    row.append(label);
    return row;
  };

  // Rebuilds only each group's inner list and detected-count, leaving the
  // <details> shells (and the user's open/closed choices) untouched. A group
  // opens itself the first time detected activity appears in it.
  const autoOpened = new Set<string>();
  const renderCandidates = (): void => {
    for (const contractType of ["openzeppelin", "argent"] as const) {
      const group = groupFor(contractType);
      const listElement = group?.querySelector("ul");
      if (!group || !listElement) continue;
      const rows = [...candidates]
        .filter((candidate) => candidate.account.accountContractType === contractType)
        .sort(
          (left, right) =>
            left.account.derivation.accountIndex - right.account.derivation.accountIndex,
        );
      listElement.replaceChildren(...rows.map(candidateRow));
      const detected = rows.filter((candidate) => candidate.deployed || candidate.funded).length;
      const detectedSlot = group.querySelector<HTMLElement>("[data-detected]");
      if (detectedSlot) {
        detectedSlot.className = "hint";
        detectedSlot.textContent = accountsDetectedText(detected);
      }
      if (detected > 0 && !autoOpened.has(contractType)) {
        autoOpened.add(contractType);
        group.open = true;
      }
    }
    refreshGate();
  };

  const apply = (next: Awaited<ReturnType<SidepanelWallet["discoverRecoveryAccounts"]>>): void => {
    for (const candidate of next.candidates) {
      const key = selectionKey(selectionFor(candidate));
      const duplicate = deps.existingIds?.().has(candidate.account.id) ?? false;
      if (!seen.has(key) && !duplicate && (candidate.deployed || candidate.funded)) {
        selected.add(key);
      }
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
      showToast(message, "error", deps.form);
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
    const commit =
      deps.restore ??
      ((mnemonic: string, networkId: string, picks: readonly RecoveryAccountSelection[]) =>
        deps.wallet.recoverAccounts(mnemonic, networkId, deps.vaultPassphrase(), picks));
    void commit(deps.mnemonic(), deps.networkId(), selections)
      .then(async () => {
        showToast(
          `${selections.length} account${selections.length === 1 ? "" : "s"} restored`,
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
