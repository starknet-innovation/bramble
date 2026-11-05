/**
 * The vault service's QSB account surface: what the background may ask of the
 * QSB accounts the encrypted vault keeps, and what it gets back. Types only,
 * split from ./service-types by behaviour. Every reply is a `QsbAccountView`
 * (never the phrase or the journal id) except `revealQsbPhrase`, the one
 * method that returns a QSB phrase, and only to a caller that re-entered the
 * wallet password.
 */
import type { QsbAccountView } from "@bramble/wallet-model/qsb";
import type { QsbJournalStores } from "../qsb/qsb-journal-stores";

/**
 * What the vault service needs to run QSB accounts: the open journal stores
 * and the randomness boundary that draws each new account's journal id
 * (`randomQsbJournalId` in production). The two come together, so a service
 * can never hold journals it has no way to name. Without them every QSB
 * account still lists, but with its journal `unavailable`, and creation and
 * import are refused.
 */
export type QsbAccountWiring = {
  readonly drawJournalId: () => string;
  readonly journals: QsbJournalStores;
};

/** A phrase to import as a read-only QSB account, under the session's password. */
export type ImportQsbAccountInput = {
  readonly mnemonic: string;
  readonly vaultPassphrase: string;
};

/** One QSB account's phrase to reveal, under the password the user re-entered. */
export type RevealQsbPhraseInput = {
  readonly accountId: string;
  readonly vaultPassphrase: string;
};

/** One word the user retyped from a QSB phrase, at its zero-based position. */
export type QsbBackupWord = {
  readonly index: number;
  readonly word: string;
};

/** The words to check a QSB backup with, under the session's password. */
export type ConfirmQsbBackupInput = {
  readonly accountId: string;
  readonly vaultPassphrase: string;
  readonly words: readonly QsbBackupWord[];
};

/**
 * The QSB account methods. Each refusal throws the matching
 * `QSB_ACCOUNT_REFUSALS` diagnostic: creation and import refuse with
 * `accountLimit`, `invalidPhrase`, `duplicatePhrase` or `notDedicated` before
 * any write and with `creationFailed` for every other failure, which may leave
 * an orphan journal no account names; reveal and confirm refuse an unknown id
 * with `unknownAccount`, and confirm wrong words with `backupMismatch`. A
 * wrong password fails exactly as reading the vault does.
 */
export type QsbAccountService = {
  /**
   * Checks the retyped words against the stored phrase and, on a generated
   * account whose backup is unconfirmed, records the confirmation. Already
   * confirmed or imported: checked, then nothing is written.
   */
  readonly confirmQsbBackup: (input: ConfirmQsbBackupInput) => Promise<QsbAccountView>;
  /**
   * Creates an account from a new 24-word phrase Krusty generates: this vault
   * is its only writer once its backup is confirmed. Writes the empty journal
   * first, then the vault; fails closed when Krusty is unavailable.
   */
  readonly createQsbAccount: (vaultPassphrase: string) => Promise<QsbAccountView>;
  /** Imports a phrase the user already holds as a read-only account, journal first. */
  readonly importQsbAccount: (input: ImportQsbAccountInput) => Promise<QsbAccountView>;
  /**
   * Every QSB account with its journal read and bound. Read-only: a missing,
   * unreadable or mismatched journal reports `unavailable` and is never
   * recreated.
   */
  readonly qsbAccounts: (vaultPassphrase: string) => Promise<readonly QsbAccountView[]>;
  /**
   * One account's phrase, after decrypting the vault with the given password.
   * Works whatever the state of its journal. The caller must never persist or
   * log it.
   */
  readonly revealQsbPhrase: (input: RevealQsbPhraseInput) => Promise<string>;
};
