/** Bounded account discovery and confirmation for phrase recovery, per family. */

import { type AccountContractType, recoveryLadderIndex } from "@bramble/wallet-model/accounts";
import type {
  RecoveryAccountCandidate,
  RecoveryAccountSelection,
} from "@bramble/wallet-model/recovery";
import {
  isRecoveryAccountIndex,
  RECOVERY_SCAN_LIMITS,
  recoveryScanTarget,
  recoverySelectionKey,
} from "@bramble/wallet-model/recovery";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorDetails, errorLine, errorMessage, showToast } from "../../shared/dom";
import { accountLabel, accountsDetectedText } from "../../shared/parts";
import {
  candidateName,
  candidateState,
  candidateTitle,
  privacyPoolCopy,
  selectable,
} from "./recovery-account-copy";
import { bindRecoveryAddressFinder } from "./recovery-address-ui";

/** One bounded discovery page as the runtime returns it. */
type DiscoveryResult = Awaited<ReturnType<SidepanelWallet["discoverRecoveryAccounts"]>>;

type RecoveryAccountUiDeps = {
  /**
   * Injected discovery page. The settings rescan of the wallet's own phrase has
   * no phrase in the panel and supplies this; the phrase-bearing flows omit it
   * and the picker calls `wallet.discoverRecoveryAccounts` with `mnemonic`.
   */
  readonly discover?: (manualIndex?: number) => Promise<DiscoveryResult>;
  /**
   * Injected address lookup, like `discover`: the own-phrase rescan has no
   * phrase in the panel. Absent, the picker asks
   * `wallet.findRecoveryAccountByAddress` with `mnemonic`.
   */
  readonly findByAddress?: (address: string) => Promise<RecoveryAccountCandidate>;
  /** Accounts already in the vault; scan candidates matching them are shown but locked. */
  readonly existingIds?: () => ReadonlySet<string>;
  readonly form: HTMLFormElement;
  /** The typed phrase; absent when `discover` supplies the page instead. */
  readonly mnemonic?: () => string;
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
  /** The typed unlock credential; absent when `restore` commits instead. */
  readonly vaultPassphrase?: () => string;
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
  // An account found by its address keeps it: no derivation reproduces it, and
  // the background re-proves the owner key before writing it (issue 398).
  ...(candidate.byAddress ? { address: candidate.account.address } : {}),
});

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
  // The scan's own page, and accounts found by pasted address, which no page
  // contains. The picker lists both.
  let scanned: readonly RecoveryAccountCandidate[] = [];
  const foundByAddress = new Map<string, RecoveryAccountCandidate>();
  const withFound = (): readonly RecoveryAccountCandidate[] => [
    ...scanned,
    ...[...foundByAddress.values()].filter(
      (found) => !scanned.some((candidate) => candidate.account.id === found.account.id),
    ),
  ];
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
    if (candidate.privacyPool && !duplicate) {
      const warning = deps.form.ownerDocument.createElement("span");
      warning.className = "hint hint-danger";
      warning.textContent = privacyPoolCopy(candidate);
      copy.append(warning);
    }
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

  const apply = (next: DiscoveryResult): void => {
    for (const candidate of next.candidates) {
      const key = selectionKey(selectionFor(candidate));
      const duplicate = deps.existingIds?.().has(candidate.account.id) ?? false;
      if (!seen.has(key) && !duplicate && (candidate.deployed || candidate.funded)) {
        trySelect(key);
      }
      seen.add(key);
    }
    scanned = next.candidates;
    candidates = withFound();
    complete = next.complete;
    renderCandidates();
    scanStatus = complete
      ? `Search complete. Checked ${next.nextIndex} indices across every account type.`
      : `Checked ${next.nextIndex} of ${recoveryScanTarget(next.candidates)} indices…`;
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
      let next: DiscoveryResult;
      do {
        next =
          deps.discover !== undefined
            ? await deps.discover(manualIndex)
            : await deps.wallet.discoverRecoveryAccounts(
                deps.mnemonic?.() ?? "",
                deps.networkId(),
                manualIndex,
              );
        if (generation !== activeGeneration) return;
        apply(next);
      } while (manualIndex === undefined && !next.complete);
    } catch (error) {
      if (generation !== activeGeneration) return;
      const message = errorMessage(error, "Account search paused. Check the network and retry.");
      if (status)
        status.textContent = errorLine(
          error,
          "Account search paused. Check the network and retry.",
        );
      showToast(
        message,
        "error",
        deps.form,
        errorDetails(error, "Account search paused. Check the network and retry."),
      );
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
    addressFinder.reset();
  };

  // Drops every candidate and pick, and makes any scan still in flight discard
  // its results. Callers set the status line; the gate follows the empty pick.
  const reset = (): void => {
    generation += 1;
    candidates = [];
    scanned = [];
    foundByAddress.clear();
    addressFinder.reset();
    complete = false;
    scanStatus = "";
    selected.clear();
    seen.clear();
    if (result) result.textContent = "";
    renderCandidates();
  };

  // A match is listed, its group opened, and picked unless it is already in
  // the wallet; the returned line reports it under the finder.
  const addFound = (candidate: RecoveryAccountCandidate): string => {
    const key = selectionKey(selectionFor(candidate));
    // The pasted address already says which account; the ladder stays on the row.
    const title = candidateName(candidate);
    const duplicate = deps.existingIds?.().has(candidate.account.id) ?? false;
    foundByAddress.set(key, candidate);
    candidates = withFound();
    if (!duplicate && selectable(candidate)) trySelect(key);
    const group = groupFor(candidate.account.accountContractType);
    if (group) group.open = true;
    renderCandidates();
    renderStatus();
    if (duplicate) return `${title} is already in this wallet.`;
    return candidate.restriction
      ? `Found ${title}. It's view only until you recover it.`
      : `Found ${title}.`;
  };
  const addressFinder = bindRecoveryAddressFinder({
    lookup: (address) =>
      deps.findByAddress !== undefined
        ? deps.findByAddress(address)
        : deps.wallet.findRecoveryAccountByAddress(
            deps.mnemonic?.() ?? "",
            deps.networkId(),
            address,
          ),
    networkId: deps.networkId,
    onFound: addFound,
    root: deps.form.querySelector<HTMLElement>('[data-recovery-address="recovery"]'),
  });

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
        deps.wallet.recoverAccounts(mnemonic, networkId, deps.vaultPassphrase?.() ?? "", picks));
    void commit(deps.mnemonic?.() ?? "", deps.networkId(), selections)
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
        if (result) result.textContent = errorLine(error, "Account recovery failed");
        showToast(message, "error", restore, errorDetails(error, "Account recovery failed"));
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
