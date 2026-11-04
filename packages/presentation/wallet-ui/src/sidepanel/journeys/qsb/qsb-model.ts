/**
 * Pure model and copy for the QSB vault screens: what a validated account
 * view shows, which words the backup asks for, and every sentence the screens
 * print. No DOM, clock, or runtime access; nothing here sees a phrase.
 *
 * The UI calls a QSB account a "QSB vault" and each of its one-deposit
 * vaults a "deposit"; the code keeps the contract's account and vault nouns.
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

/** The account type's name: the add tile, the backup subtitle, one account's screen. */
export const QSB_NAME = "QSB vault";
/** The accounts list's title, and the drawer row that opens it. */
export const QSB_TITLE = "QSB vaults";
/** What the 24 words are called on the QSB screens, where others say "recovery phrase". */
export const QSB_PHRASE_NAME = "QSB vault phrase";

/** Where the add-account and import choosers enter the journey. */
export type QsbRoute = "create" | "import";

/**
 * What one account row says, most urgent first: a phrase not yet backed up,
 * then a history Bramble cannot read (it then releases no key), then whether
 * it may take new deposits (`ready`) or only read them (`read-only`).
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

/** `QSB vault <n>` for a validated `qsb-<n>` id. */
export const qsbAccountLabel = (id: string): string => `${QSB_NAME} ${id.slice("qsb-".length)}`;

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
export const QSB_LOADING = "Loading QSB vaults…";
/** The list's empty state. */
export const QSB_EMPTY = "No QSB vaults yet.";
/** While the background creates an account. */
export const QSB_CREATING = "Creating QSB vault…";
/** Under the phrase, where Bramble hands it over. A warning: no contractions. */
export const QSB_PHRASE_WARNING =
  "Anyone with these words controls this QSB vault's bitcoin. Bramble cannot recover them for you.";
/** The import screen's consequence, stated before the user commits. */
export const QSB_IMPORT_READ_ONLY = "An imported phrase can't take new deposits here.";
/** After an import, naming the row it added. */
export const qsbImported = (id: string): string => `Imported as ${qsbAccountLabel(id)}.`;

// Any QSB write whose reply was lost (a create, an import, a backup check, a
// new deposit, a funding or a resend) may still have run; refreshing the
// screen it came from says whether it did. One sentence for all of them.
const QSB_OUTCOME_UNKNOWN = "Bramble couldn't confirm this finished. Refresh before trying again.";

/**
 * The status line for every rejected QSB write: the outcome-unknown sentence
 * when the write may have run, otherwise the refusal's reviewed copy (or the
 * caller's fallback diagnostic's).
 */
export const qsbWriteFailure = (error: unknown, fallback: string): string =>
  isOutcomeUnknown(error) ? QSB_OUTCOME_UNKNOWN : errorLine(error, fallback);
