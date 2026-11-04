/**
 * Import a Quantum-safe Bitcoin phrase: 24 words through the shared recovery
 * grid and BIP39 word assist, then `wallet.importQsbAccount`. An imported
 * phrase stays read-only for life, which the screen says before the user
 * commits. Word membership is advisory only; the background validates the
 * mnemonic through Krusty and refuses a Starknet phrase.
 *
 * Secret boundary: the phrase lives only in the grid's cells and is read once,
 * at submit, into the privileged request. A successful import empties every
 * cell; `wipe` does the same and drops a reply still in flight, and the
 * journey calls it whenever this screen is left or repainted.
 */
import { escapeHtml } from "@bramble/core/html";
import { button } from "@bramble/ui-kit/controls";
import { QSB_ACCOUNT_REFUSALS, QSB_PHRASE_WORDS } from "@bramble/wallet-model/qsb";
import type { WalletStatus } from "../../../popup/responses/responses";
import { buttonBusy } from "../../shared/dom";
import { flowHeader, flowScreen } from "../../shared/parts";
import { recoveryWordInputs } from "../onboarding/onboarding-views";
import { bindRecoveryWordAssist } from "../onboarding/recovery-word-assist";
import {
  bindRecoveryWordEntry,
  fillRecoveryWords,
  recoveryWordsFrom,
  setRecoveryWordCount,
} from "../onboarding/recovery-word-state";
import { QSB_IMPORT_READ_ONLY, QSB_TITLE, qsbImported, qsbWriteFailure } from "./qsb-model";
import type { QsbWallet } from "./qsb-runtime";

/** Renders the entry and done steps; {@link bindQsbImport} moves between them. */
export const qsbImportFlow = (status: WalletStatus): string =>
  flowHeader("Import a vault phrase", status, QSB_TITLE) +
  flowScreen(
    "qsb-import",
    `<section class="section">
      <form id="qsb-import-form" class="stack" novalidate>
        <div class="stack" data-qsb-import-step="entry">
          <p class="hint" role="note">${escapeHtml(QSB_IMPORT_READ_ONLY)}</p>
          <div class="recovery-grid" data-recovery-grid="import">${recoveryWordInputs("import")}</div>
          <div class="recovery-actions">
            <button class="onboarding-inline-action" id="phrase-clear" type="button">Clear</button>
          </div>
          <p id="qsb-import-result" role="status"></p>
          ${button({ attributes: { id: "qsb-import-submit" }, disabled: true, label: "Import phrase", type: "submit" })}
        </div>
        <div class="stack" data-qsb-import-step="done" hidden>
          <p id="qsb-import-done" role="status"></p>
          ${button({ attributes: { id: "qsb-import-finish" }, label: "Done" })}
        </div>
      </form>
    </section>`,
  );

/** What the import binding needs. */
export type QsbImportDeps = {
  readonly done: () => void;
  readonly form: HTMLFormElement;
  readonly wallet: Pick<QsbWallet, "importQsbAccount">;
};

/** The bound screen; `wipe` empties every cell. */
export type QsbImportSession = { readonly wipe: () => void };

/**
 * Binds the import form. The submit stays disabled until all 24 cells hold a
 * word; a refusal keeps the words so one can be corrected.
 */
export const bindQsbImport = ({ done, form, wallet }: QsbImportDeps): QsbImportSession => {
  const inputs = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[data-recovery-kind="import"]'),
  );
  const submit = form.querySelector<HTMLButtonElement>("#qsb-import-submit");
  const result = form.querySelector<HTMLElement>("#qsb-import-result");
  const steps = Array.from(form.querySelectorAll<HTMLElement>("[data-qsb-import-step]"));
  // Bumped by `wipe`: an answer after it belongs to a screen the user left.
  let generation = 0;
  // A QSB phrase is always 24 words: every cell shows, whatever was pasted.
  const showAllCells = (): void => setRecoveryWordCount(form, inputs, QSB_PHRASE_WORDS, "import");
  showAllCells();
  const assist = bindRecoveryWordAssist(inputs, form);
  const words = (): readonly string[] => recoveryWordsFrom(inputs, QSB_PHRASE_WORDS);

  const refresh = (): void => {
    const current = words();
    const incomplete = current.some((word) => word.length === 0);
    assist.refreshWordValidity();
    if (submit) submit.disabled = incomplete;
    if (!result) return;
    // Emptiness only gates the submit; word membership stays advisory.
    result.textContent = incomplete
      ? current.some((word) => word.length > 0)
        ? `Enter all ${QSB_PHRASE_WORDS} words to continue.`
        : ""
      : assist.wordsKnown(QSB_PHRASE_WORDS)
        ? ""
        : "Highlighted words are not in the BIP39 English list.";
  };
  bindRecoveryWordEntry({
    clear: form.querySelector<HTMLButtonElement>("#phrase-clear"),
    fillWords: (pasted) => {
      fillRecoveryWords(form, inputs, pasted, "import");
      showAllCells();
    },
    inputs,
    onChange: refresh,
  });

  const wipe = (): void => {
    generation += 1;
    for (const input of inputs) input.value = "";
    assist.hideSuggestions();
    refresh();
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const current = words();
    if (current.some((word) => word.length === 0)) return;
    const attempt = generation;
    buttonBusy(submit, true);
    void wallet.importQsbAccount(current.join(" ")).then(
      (account) => {
        buttonBusy(submit, false);
        // A wiped screen keeps its emptied state, submit included.
        if (attempt !== generation) return refresh();
        wipe();
        const line = form.querySelector<HTMLElement>("#qsb-import-done");
        if (line) line.textContent = qsbImported(account.id);
        for (const step of steps) step.hidden = step.dataset["qsbImportStep"] !== "done";
        form.querySelector<HTMLButtonElement>("#qsb-import-finish")?.focus();
      },
      (error: unknown) => {
        buttonBusy(submit, false);
        if (attempt !== generation) return refresh();
        if (result) result.textContent = qsbWriteFailure(error, QSB_ACCOUNT_REFUSALS.invalidPhrase);
      },
    );
  });
  form.querySelector<HTMLButtonElement>("#qsb-import-finish")?.addEventListener("click", done);

  refresh();
  return { wipe };
};
