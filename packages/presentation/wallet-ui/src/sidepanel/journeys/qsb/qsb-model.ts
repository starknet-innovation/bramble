/**
 * Pure model and copy for the Quantum-safe Bitcoin screens: what a validated
 * account view shows, which words the backup asks for, and every sentence the
 * screens print. No DOM, clock, or runtime access; nothing here sees a phrase.
 */
import {
  QSB_BACKUP_CHECK_WORDS,
  QSB_PHRASE_WORDS,
  type QsbAccountView,
} from "@bramble/wallet-model/qsb";
import { isOutcomeUnknown } from "../../runtime/runtime-errors";
import { errorLine } from "../../shared/dom";
import { backupVerifyPositions } from "../onboarding/backup-verify";
import type { QsbBackupWord } from "./qsb-runtime";

/** The account type's name: the drawer row, the screen title, the tiles. */
export const QSB_TITLE = "Quantum-safe Bitcoin";

/** Where the add-account and import choosers enter the journey. */
export type QsbRoute = "create" | "import";

/**
 * What one account row says, most urgent first: a phrase not yet backed up,
 * then a history Bramble cannot read (it then releases no key), then whether
 * it may create vaults (`ready`) or only read them (`read-only`).
 */
export type QsbAccountState = "backup-needed" | "history-unavailable" | "read-only" | "ready";

/**
 * The state a validated view shows. Total over the views the client accepts:
 * a backed-up account with a bound journal is a writer exactly when it was
 * generated here, so the last two branches cover the rest.
 */
export const qsbAccountState = (account: QsbAccountView): QsbAccountState => {
  if (!account.backupConfirmed) return "backup-needed";
  if (account.journal === "unavailable") return "history-unavailable";
  return account.writer ? "ready" : "read-only";
};

/** Each state's short label, shown under the account's name. */
export const QSB_STATE_LABEL: Readonly<Record<QsbAccountState, string>> = {
  "backup-needed": "Backup needed",
  "history-unavailable": "History unavailable",
  "read-only": "Read-only",
  ready: "Ready",
};

/** The one state whose consequence the label alone does not carry. */
export const QSB_HISTORY_UNAVAILABLE_HINT = "Bramble won't release any of its keys.";

/** `Account <n>` for a validated `qsb-<n>` id. */
export const qsbAccountLabel = (id: string): string => `Account ${id.slice("qsb-".length)}`;

/**
 * The 1-based phrase positions the backup asks for: one per band of the
 * 24 words, chosen by the injected `variation` (a clock reading at the
 * boundary), never by the phrase.
 */
export const qsbCheckPositions = (variation: number): readonly number[] =>
  backupVerifyPositions(QSB_PHRASE_WORDS, variation);

/**
 * The words `wallet.confirmQsbBackup` takes: one per asked position, at its
 * 0-based index, trimmed and lowercased. Null until exactly
 * {@link QSB_BACKUP_CHECK_WORDS} distinct positions each have a word, so an
 * incomplete or malformed check is never sent.
 */
export const qsbBackupWords = (
  positions: readonly number[],
  answers: readonly string[],
): readonly QsbBackupWord[] | null => {
  const words = positions.map((position, index) => ({
    index: position - 1,
    word: (answers[index] ?? "").trim().toLowerCase(),
  }));
  const distinct = new Set(words.map(({ index }) => index)).size === words.length;
  const inRange = words.every(
    ({ index }) => Number.isInteger(index) && index >= 0 && index < QSB_PHRASE_WORDS,
  );
  return words.length === QSB_BACKUP_CHECK_WORDS &&
    distinct &&
    inRange &&
    words.every(({ word }) => word.length > 0)
    ? words
    : null;
};

/** Shown while the list loads from the vault. */
export const QSB_LOADING = "Loading accounts…";
/** The list's empty state. */
export const QSB_EMPTY = "No quantum-safe Bitcoin accounts yet.";
/** While the background creates an account. */
export const QSB_CREATING = "Creating account…";
/** Under the phrase, where Bramble hands it over. A warning: no contractions. */
export const QSB_PHRASE_WARNING =
  "Anyone with these words controls your Bitcoin vaults. Bramble cannot recover them for you.";
/** The import screen's consequence, stated before the user commits. */
export const QSB_IMPORT_READ_ONLY = "An imported phrase can't create new vaults here.";
/** After an import, naming the row it added. */
export const qsbImported = (id: string): string => `Imported as ${qsbAccountLabel(id)}.`;

// A create, import, or backup confirmation whose reply was lost may still
// have run; the list says whether it did.
const QSB_OUTCOME_UNKNOWN =
  "Bramble couldn't confirm this finished. Check your accounts before trying again.";

/**
 * The status line for a rejected QSB write: the outcome-unknown sentence when
 * the write may have run, otherwise the refusal's reviewed copy (or the
 * caller's fallback diagnostic).
 */
export const qsbWriteFailure = (error: unknown, fallback: string): string =>
  isOutcomeUnknown(error) ? QSB_OUTCOME_UNKNOWN : errorLine(error, fallback);
