/** Bounded account discovery and confirmation for phrase recovery, per family. */

import { accountClassEntry } from "@bramble/wallet-model/account-families";
import {
  type AccountContractType,
  ARGENT_ACCOUNT_CLASS_HASH,
  recoveryLadderIndex,
} from "@bramble/wallet-model/accounts";
import { sameFelt } from "@bramble/wallet-model/networks";
import type {
  RecoveryAccountCandidate,
  RecoveryAccountSelection,
} from "@bramble/wallet-model/recovery";
import {
  isRecoveryAccountIndex,
  RECOVERY_SCAN_LIMITS,
  recoverySelectionKey,
} from "@bramble/wallet-model/recovery";
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
  /**
   * Runs after a successful restore, before the repaint, once the picker has
   * been emptied. The in-wallet import uses it to wipe the typed phrase: its
   * screen does not change on success, so the repaint would keep the words in
   * plain inputs. First-run omits it; success there tears the screen down.
   */
  readonly onRestored?: () => void;
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

const selectionKey = recoverySelectionKey;

// The candidate's class travels with the pick; without it the vault re-derives
// at the family default and restores a different account than the one shown.
const selectionFor = (candidate: RecoveryAccountCandidate): RecoveryAccountSelection => ({
  accountContractType: candidate.account.accountContractType,
  accountIndex: recoveryLadderIndex(candidate.account),
  ...(candidate.account.accountContractType === "openzeppelin"
    ? {}
    : { classHash: candidate.account.classHash }),
  // Argent walks two ladders (issue 505); every other family has one, so the
  // scheme only needs spelling out where re-deriving could pick the wrong one.
  ...(candidate.account.accountContractType === "argent"
    ? { derivation: candidate.account.derivation.kind }
    : {}),
});

// Only the class this wallet itself deploys can be brought on chain from here.
// A funded Argent 0.3.x address is a real counterfactual account, but deployment
// accepts only the pinned Argent release, so "ready to deploy" would promise a
// transaction that is refused.
const deployableHere = (candidate: RecoveryAccountCandidate): boolean =>
  candidate.account.accountContractType === "openzeppelin" ||
  (candidate.account.accountContractType === "argent" &&
    sameFelt(candidate.account.classHash, ARGENT_ACCOUNT_CLASS_HASH));

const activityState = (candidate: RecoveryAccountCandidate): string => {
  if (candidate.deployed) return "Deployed on Starknet";
  if (candidate.funded) {
    return deployableHere(candidate)
      ? "Funded and ready to deploy"
      : "Funded on Starknet — Bramble cannot deploy this Argent release";
  }
  return candidate.account.accountContractType === "argent"
    ? "No on-chain activity found — Bramble only imports existing Ready accounts"
    : "No on-chain activity found";
};

// A Braavos account is restored to be seen, not yet used: say so before the
// user picks it, rather than after a send fails. It is never offered for
// deployment either, since Bramble does not deploy Braavos accounts.
const candidateState = (candidate: RecoveryAccountCandidate, duplicate: boolean): string => {
  if (duplicate) return "Already in this wallet";
  if (candidate.account.accountContractType !== "braavos") return activityState(candidate);
  return `${candidate.deployed ? "Deployed on Starknet" : "Funded, not deployed"} · view only for now`;
};

// Two Argent releases at one index are two accounts. Name the release on any
// but the one Bramble creates, so rows that share an index can be told apart.
const candidateTitle = (candidate: RecoveryAccountCandidate): string => {
  const { account } = candidate;
  const title = `Account ${recoveryLadderIndex(account)}`;
  if (
    account.accountContractType !== "argent" ||
    sameFelt(account.classHash, ARGENT_ACCOUNT_CLASS_HASH)
  ) {
    return title;
  }
  const release = accountClassEntry(account.classHash)?.label.replace(/^argent /, "");
  return release ? `${title} · Argent ${release}` : title;
};

// Bramble creates only Bramble accounts: any other candidate with no on-chain
// history would be a brand-new deployment in a family Bramble does not create,
// so it is listed but not selectable. Deployed or funded (counterfactual)
// accounts in those families stay importable.
const selectable = (candidate: RecoveryAccountCandidate): boolean =>
  candidate.account.accountContractType === "openzeppelin" ||
  candidate.deployed ||
  candidate.funded;

/** Binds and runs the recovery account picker without retaining the phrase. */
export const bindRecoveryAccountUi = (deps: RecoveryAccountUiDeps): RecoveryAccountUi => {
  const groupFor = (contractType: AccountContractType): HTMLDetailsElement | null =>
    deps.form.querySelector<HTMLDetailsElement>(`[data-recovery-group="${contractType}"]`);
  const status = deps.form.querySelector<HTMLElement>("#recovery-scan-status");
  const result = deps.form.querySelector<HTMLElement>("#recovery-accounts-result");
  const retry = deps.form.querySelector<HTMLButtonElement>("#recovery-scan-retry");
  const restore = deps.form.querySelector<HTMLButtonElement>("#recover-accounts-button");
  const manual = deps.form.querySelector<HTMLInputElement>('input[name="recoveryManualIndex"]');
  const manualSearch = deps.form.querySelector<HTMLButtonElement>("#recovery-manual-search");
  let candidates: readonly RecoveryAccountCandidate[] = [];
  let complete = false;
  let scanStatus = "";
  let generation = 0;
  let restartOnIdle = false;
  let scanning = false;
  const selected = new Set<string>();
  const seen = new Set<string>();
  // Discovery can surface more active accounts than one restore accepts (six
  // classes per index, twenty indices). Auto-select and manual checks both
  // stop at that bound so a valid scan cannot submit an invalid restore.
  const trySelect = (key: string): boolean => {
    if (selected.has(key)) return true;
    if (selected.size >= RECOVERY_SCAN_LIMITS.maxSelections) return false;
    selected.add(key);
    return true;
  };
  const selectionNote = (): string => {
    if (selected.size < RECOVERY_SCAN_LIMITS.maxSelections) return "";
    const waiting = candidates.some((candidate) => {
      if (!candidate.deployed && !candidate.funded) return false;
      if (deps.existingIds?.().has(candidate.account.id)) return false;
      return !selected.has(selectionKey(selectionFor(candidate)));
    });
    return waiting
      ? ` At most ${RECOVERY_SCAN_LIMITS.maxSelections} accounts can be restored at once. Uncheck one to choose another.`
      : "";
  };
  const renderStatus = (): void => {
    if (status) status.textContent = `${scanStatus}${selectionNote()}`;
  };

  const refreshGate = (): void => {
    if (restore) restore.disabled = selected.size === 0;
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
      if (checkbox.checked) {
        if (!trySelect(key)) {
          checkbox.checked = false;
          showToast(
            `Choose at most ${RECOVERY_SCAN_LIMITS.maxSelections} accounts. Uncheck one to add another.`,
            "error",
            checkbox,
          );
          return;
        }
      } else selected.delete(key);
      refreshGate();
      renderStatus();
    });
    const copy = deps.form.ownerDocument.createElement("span");
    copy.className = "allowance-copy";
    const title = deps.form.ownerDocument.createElement("strong");
    title.textContent = candidateTitle(candidate);
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
    for (const contractType of ["openzeppelin", "argent", "braavos"] as const) {
      const group = groupFor(contractType);
      const listElement = group?.querySelector("ul");
      if (!group || !listElement) continue;
      const rows = [...candidates]
        .filter((candidate) => candidate.account.accountContractType === contractType)
        .sort(
          (left, right) => recoveryLadderIndex(left.account) - recoveryLadderIndex(right.account),
        );
      listElement.replaceChildren(...rows.map(candidateRow));
      const detected = rows.filter((candidate) => candidate.deployed || candidate.funded).length;
      const detectedSlot = group.querySelector<HTMLElement>("[data-detected]");
      if (detectedSlot) {
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
        trySelect(key);
      }
      seen.add(key);
    }
    candidates = next.candidates;
    complete = next.complete;
    renderCandidates();
    scanStatus = complete
      ? `Search complete. Checked ${next.nextIndex} indices across every account type.`
      : `Checked ${next.nextIndex} of ${RECOVERY_SCAN_LIMITS.defaultCount} indices…`;
    renderStatus();
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

  // Drops every candidate and pick, and makes any scan still in flight discard
  // its results. Callers set the status line; the gate follows the empty pick.
  const reset = (): void => {
    generation += 1;
    candidates = [];
    complete = false;
    scanStatus = "";
    selected.clear();
    seen.clear();
    if (result) result.textContent = "";
    renderCandidates();
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
  restore?.addEventListener("click", () => {
    const selections = candidates
      .map(selectionFor)
      .filter((selection) => selected.has(selectionKey(selection)));
    if (selections.length === 0) return;
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
        if (deps.onRestored) {
          // Release busy first: it re-enables the button, and the reset's
          // gate must be what disables it again over an empty pick.
          buttonBusy(restore, false);
          restartOnIdle = false;
          reset();
          if (status) status.textContent = "";
          deps.onRestored();
        }
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
      if (status) status.textContent = "Searching every account type…";
      reset();
      if (scanning) restartOnIdle = true;
      else void scan();
    },
  };
};
