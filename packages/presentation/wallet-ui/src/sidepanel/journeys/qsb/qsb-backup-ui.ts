/**
 * Back up a QSB vault phrase: re-enter the wallet passphrase, see
 * the 24 words masked until asked, retype three of them, and let the
 * background check them. The same screen shows a new account being created
 * first, so creation goes straight into its backup.
 *
 * Secret boundary: the vault passphrase is read from its field once, at
 * submit, and the field is emptied as it is sent; it is never kept. The phrase
 * lives only in the grid's read-only cells, the one copy the guarded copy
 * reads; "I saved my phrase" empties them before the check words are asked.
 * `wipe` empties every field and drops any reply still in flight, and the
 * journey calls it whenever this screen is left or repainted.
 */
import { escapeHtml } from "@bramble/core/html";
import { emptyState } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { textField } from "@bramble/ui-kit/fields";
import { MIN_VAULT_PASSPHRASE_LENGTH } from "@bramble/wallet-model/passphrase";
import { QSB_ACCOUNT_REFUSALS, QSB_PHRASE_WORDS } from "@bramble/wallet-model/qsb";
import type { WalletStatus } from "../../../popup/responses/responses";
import { friendlyError } from "../../runtime/friendly-error";
import { isOutcomeUnknown } from "../../runtime/runtime-errors";
import { buttonBusy, errorLine } from "../../shared/dom";
import { GUARDED_COPY_NOTE, guardedCopyNote } from "../../shared/guarded-copy";
import { flowHeader, flowScreen } from "../../shared/parts";
import { BACKUP_VERIFY_COPY } from "../onboarding/backup-verify";
import { bindGeneratedPhrase } from "../onboarding/generated-phrase-ui";
import { recoveryWordInputs } from "../onboarding/onboarding-views";
import { fillRecoveryWords, recoveryWordsFrom } from "../onboarding/recovery-word-state";
import {
  QSB_CREATING,
  QSB_NAME,
  QSB_PHRASE_NAME,
  QSB_PHRASE_WARNING,
  QSB_TITLE,
  qsbAccountLabel,
  qsbBackupWords,
  qsbCheckPositions,
  qsbWriteFailure,
} from "./qsb-model";
import type { QsbWallet } from "./qsb-runtime";

/**
 * Whose phrase the screen backs up: an existing account, one being created,
 * a sentence saying why there is none (a refused or unknown creation), or
 * nothing chosen yet. Ids only; never a phrase.
 */
export type QsbBackupTarget =
  | { readonly id: string; readonly kind: "account" }
  | { readonly kind: "creating" }
  | { readonly kind: "failed"; readonly line: string }
  | { readonly kind: "none" };

type Step = "creating" | "done" | "passphrase" | "phrase" | "unavailable" | "verify";

const verifyFields = (): string =>
  qsbCheckPositions(0)
    .map((position, index) =>
      textField({
        autocomplete: "off",
        autocapitalize: "off",
        inputmode: "text",
        label: `Word ${position}`,
        name: `qsb-verify-${index}`,
        spellcheck: false,
      }),
    )
    .join("");

/** Renders every step, all but one hidden; {@link bindQsbBackup} moves between them. */
export const qsbBackupFlow = (status: WalletStatus): string =>
  flowHeader("Back up your phrase", status, QSB_NAME) +
  flowScreen(
    "qsb-backup",
    `<div id="qsb-backup" class="stack">
      <p class="eyebrow" id="qsb-backup-account"></p>
      <section class="section" data-qsb-step="creating" hidden>${emptyState(QSB_CREATING, "status")}</section>
      <section class="section" data-qsb-step="unavailable" hidden>
        <p class="review-flag" id="qsb-backup-error" role="alert"></p>
        ${button({ attributes: { "data-view": "qsb-accounts" }, label: `View ${QSB_TITLE}`, variant: "secondary" })}
      </section>
      <section class="section" data-qsb-step="passphrase" hidden>
        <form id="qsb-reveal-form" class="stack">
          ${textField({
            autocomplete: "current-password",
            // The QSB screens' own word for it; the rest of the wallet says
            // "Vault passphrase". The field's name is unchanged.
            label: "Wallet passphrase",
            minlength: MIN_VAULT_PASSPHRASE_LENGTH,
            name: "vaultPassphrase",
            required: true,
            type: "password",
          })}
          ${button({ icon: "lock", label: "Show phrase", type: "submit" })}
          <p id="qsb-reveal-result" role="status"></p>
        </form>
      </section>
      <section class="section" data-qsb-step="phrase" hidden>
        <form id="qsb-phrase-form" class="stack" novalidate>
          <p class="hint">${escapeHtml(QSB_PHRASE_WARNING)}</p>
          <div class="recovery-grid is-masked" data-recovery-grid="generated" aria-hidden="true" inert>${recoveryWordInputs("generated")}</div>
          <div class="button-row">
            ${button({
              attributes: { "aria-label": `Show ${QSB_PHRASE_NAME}`, id: "phrase-toggle" },
              icon: "book",
              label: "Show",
              variant: "secondary",
            })}
            ${button({
              attributes: { "aria-label": `Copy ${QSB_PHRASE_NAME}`, id: "generated-copy-phrase" },
              disabled: true,
              icon: "copy",
              label: "Copy",
              variant: "ghost",
            })}
          </div>
          <p class="hint" id="qsb-copy-note">${escapeHtml(GUARDED_COPY_NOTE)}</p>
          ${button({ attributes: { id: "generated-continue" }, disabled: true, label: "I saved my phrase" })}
        </form>
      </section>
      <section class="section" data-qsb-step="verify" hidden>
        <form id="qsb-verify-form" class="stack" novalidate>
          <div class="verify-grid">${verifyFields()}</div>
          <p id="qsb-verify-result" role="status">${escapeHtml(BACKUP_VERIFY_COPY.incomplete)}</p>
          ${button({ disabled: true, label: "Confirm backup", type: "submit" })}
          ${button({ attributes: { id: "qsb-verify-back" }, label: "Show phrase again", variant: "ghost" })}
        </form>
      </section>
      <section class="section" data-qsb-step="done" hidden>
        <p role="status">${escapeHtml(BACKUP_VERIFY_COPY.confirmed)}</p>
        ${button({ attributes: { id: "qsb-backup-done" }, label: "Done" })}
      </section>
    </div>`,
  );

/** What the backup binding needs. `target` is read live, never copied. */
export type QsbBackupDeps = {
  readonly done: () => void;
  readonly now: (() => number) | null;
  readonly root: HTMLElement;
  readonly target: () => QsbBackupTarget;
  readonly wallet: Pick<QsbWallet, "confirmQsbBackup" | "revealQsbPhrase">;
};

/** The bound screen: `refresh` re-reads the target; `wipe` empties every field. */
export type QsbBackupSession = { readonly refresh: () => void; readonly wipe: () => void };

/**
 * Binds the backup steps under `root` and shows the one the target calls for.
 * Missing controls are skipped. A reply that arrives after `wipe` is dropped,
 * so a phrase can never be written into a screen the user has left.
 */
export const bindQsbBackup = (deps: QsbBackupDeps): QsbBackupSession => {
  const { root, wallet } = deps;
  const find = <T extends Element>(selector: string): T | null => root.querySelector<T>(selector);
  const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-qsb-step]"));
  const revealForm = find<HTMLFormElement>("#qsb-reveal-form");
  const passphrase = revealForm?.querySelector<HTMLInputElement>('input[name="vaultPassphrase"]');
  const revealSubmit = revealForm?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const revealResult = find<HTMLElement>("#qsb-reveal-result");
  const phraseForm = find<HTMLFormElement>("#qsb-phrase-form");
  const cells = Array.from(
    phraseForm?.querySelectorAll<HTMLInputElement>('input[data-recovery-kind="generated"]') ?? [],
  );
  const verifyForm = find<HTMLFormElement>("#qsb-verify-form");
  const verifyInputs = Array.from(
    verifyForm?.querySelectorAll<HTMLInputElement>('input[name^="qsb-verify-"]') ?? [],
  );
  const verifySubmit = verifyForm?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const verifyResult = find<HTMLElement>("#qsb-verify-result");
  let positions = qsbCheckPositions(0);
  // Bumped by `wipe`: a reveal or check answered after it belongs to a screen
  // the user already left.
  let generation = 0;

  const show = (step: Step, focus = false): void => {
    for (const section of steps) section.hidden = section.dataset["qsbStep"] !== step;
    if (focus) {
      steps
        .find((section) => !section.hidden)
        ?.querySelector<HTMLElement>("input:not([readonly]), button:not([disabled])")
        ?.focus();
    }
  };
  // Every cell, and nothing else, holds the phrase: empty them all or none.
  const readPhrase = (): string => {
    const words = recoveryWordsFrom(cells, QSB_PHRASE_WORDS);
    return words.every((word) => word.length > 0) ? words.join(" ") : "";
  };
  const generated = phraseForm
    ? bindGeneratedPhrase(phraseForm, readPhrase, QSB_PHRASE_NAME)
    : null;
  const clearPhrase = (): void => {
    if (phraseForm) fillRecoveryWords(phraseForm, cells, [], "generated");
    generated?.reset();
  };
  const answers = (): readonly string[] => verifyInputs.map((input) => input.value);
  // Returns whether every asked word is filled in.
  const syncVerify = (): boolean => {
    const ready = qsbBackupWords(positions, answers()) !== null;
    if (verifySubmit) verifySubmit.disabled = !ready;
    return ready;
  };
  // A refusal reads as an error to fix; anything else as where the check stands.
  const verifyLine = (text: string, refused = false): void => {
    if (!verifyResult) return;
    verifyResult.textContent = text;
    verifyResult.classList.toggle("is-invalid", refused);
  };
  const clearVerify = (): void => {
    for (const input of verifyInputs) input.value = "";
    verifyLine(BACKUP_VERIFY_COPY.incomplete);
    syncVerify();
  };
  const wipe = (): void => {
    generation += 1;
    if (passphrase) passphrase.value = "";
    if (revealResult) revealResult.textContent = "";
    clearPhrase();
    clearVerify();
  };
  const accountId = (): string | null => {
    const target = deps.target();
    return target.kind === "account" ? target.id : null;
  };

  const refresh = (): void => {
    wipe();
    const target = deps.target();
    const label = find<HTMLElement>("#qsb-backup-account");
    if (label) label.textContent = target.kind === "account" ? qsbAccountLabel(target.id) : "";
    if (target.kind === "account" || target.kind === "creating") {
      show(target.kind === "account" ? "passphrase" : "creating");
      return;
    }
    const error = find<HTMLElement>("#qsb-backup-error");
    if (error) {
      error.textContent =
        target.kind === "failed"
          ? target.line
          : friendlyError(QSB_ACCOUNT_REFUSALS.unknownAccount).message;
    }
    show("unavailable");
  };

  revealForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const typed = passphrase?.value ?? "";
    // The passphrase leaves the page as it is sent; a wrong one is retyped.
    if (passphrase) passphrase.value = "";
    const id = accountId();
    if (id === null || typed.length === 0) return;
    const attempt = generation;
    buttonBusy(revealSubmit, true);
    if (revealResult) revealResult.textContent = "";
    void wallet.revealQsbPhrase(id, typed).then(
      (phrase) => {
        buttonBusy(revealSubmit, false);
        if (attempt !== generation || !phraseForm) return;
        fillRecoveryWords(phraseForm, cells, phrase.split(" "), "generated");
        generated?.reset();
        show("phrase", true);
      },
      (error: unknown) => {
        buttonBusy(revealSubmit, false);
        if (attempt !== generation) return;
        if (revealResult) revealResult.textContent = errorLine(error, "reveal failed");
        passphrase?.focus();
      },
    );
  });

  // The clipboard warning that is true for this page (Firefox cannot clear).
  const copyNote = find<HTMLElement>("#qsb-copy-note");
  if (copyNote) copyNote.textContent = guardedCopyNote(root.ownerDocument.defaultView);

  find<HTMLButtonElement>("#generated-continue")?.addEventListener("click", () => {
    clearPhrase();
    positions = qsbCheckPositions(deps.now?.() ?? 0);
    verifyInputs.forEach((input, index) => {
      const label = input.closest("label")?.querySelector("span");
      const position = positions[index];
      if (label && position !== undefined) label.textContent = `Word ${position}`;
    });
    clearVerify();
    show("verify", true);
  });

  // Typing replaces a refusal with where the check stands now.
  for (const input of verifyInputs) {
    input.addEventListener("input", () => {
      verifyLine(syncVerify() ? "" : BACKUP_VERIFY_COPY.incomplete);
    });
  }
  verifyForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const id = accountId();
    const words = qsbBackupWords(positions, answers());
    if (id === null || words === null) return;
    const attempt = generation;
    buttonBusy(verifySubmit, true);
    void wallet.confirmQsbBackup(id, words).then(
      () => {
        buttonBusy(verifySubmit, false);
        // A wiped screen keeps its emptied state, submit included.
        if (attempt !== generation) return void syncVerify();
        clearVerify();
        show("done", true);
      },
      (error: unknown) => {
        buttonBusy(verifySubmit, false);
        if (attempt !== generation) return void syncVerify();
        // An unknown outcome is not a wrong word: it is never styled as one.
        verifyLine(
          qsbWriteFailure(error, QSB_ACCOUNT_REFUSALS.backupMismatch),
          !isOutcomeUnknown(error),
        );
        syncVerify();
      },
    );
  });

  find<HTMLButtonElement>("#qsb-verify-back")?.addEventListener("click", () => {
    clearVerify();
    show("passphrase", true);
  });
  find<HTMLButtonElement>("#qsb-backup-done")?.addEventListener("click", () => {
    wipe();
    deps.done();
  });

  refresh();
  return { refresh, wipe };
};
