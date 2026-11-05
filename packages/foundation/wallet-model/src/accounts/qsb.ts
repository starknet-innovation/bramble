/**
 * The contract the background and the wallet UI share for Quantum Safe Bitcoin
 * (QSB) accounts: the public view of one account, the sizes both sides
 * enforce, and the refusal diagnostics the background throws and the UI
 * translates. Shapes and constants only; whoever receives a reply validates it
 * again before trusting it.
 *
 * The messages, all for extension pages only and never reachable by a site:
 * - `wallet.qsbAccounts`: every QSB account, as a {@link QsbAccountView}.
 * - `wallet.createQsbAccount`: a new account whose phrase the background
 *   generates and keeps. It starts with its backup unconfirmed, so it cannot
 *   allocate a vault until `wallet.confirmQsbBackup` succeeds.
 * - `wallet.importQsbAccount`: an account from a phrase the user already
 *   holds. It is read-only for life: another copy of the phrase may already
 *   have disclosed secrets this wallet cannot know about.
 * - `wallet.revealQsbPhrase`: the only message whose reply carries a QSB
 *   phrase. The wallet password is re-entered in the request and never taken
 *   from the unlocked session.
 * - `wallet.confirmQsbBackup`: checks {@link QSB_BACKUP_CHECK_WORDS} words the
 *   user retyped against the stored phrase and, when every one matches, marks
 *   the backup confirmed.
 */

/** Words in a dedicated QSB phrase: 24, so it carries 256 bits of entropy. */
export const QSB_PHRASE_WORDS = 24;

/** Words the user retypes, at distinct positions, to confirm a QSB backup. */
export const QSB_BACKUP_CHECK_WORDS = 3;

/**
 * Where a QSB account's phrase came from. A `generated-here` phrase was
 * generated in this wallet, which is therefore its only possible writer; an
 * `imported` one is read-only.
 */
export type QsbProvenance = "generated-here" | "imported";

/**
 * One QSB account as the UI may see it. It never carries the phrase or the
 * journal id. `writer` is true only for a generated account whose backup is
 * confirmed and whose journal is bound: only such an account may allocate a
 * vault. `journal` is `unavailable` when the account's disclosure journal is
 * missing, unreadable or does not match the account, and every disclosure
 * then fails closed.
 */
export type QsbAccountView = {
  readonly backupConfirmed: boolean;
  readonly id: string;
  readonly journal: "bound" | "unavailable";
  readonly provenance: QsbProvenance;
  readonly writer: boolean;
};

/**
 * The diagnostics the background throws when it refuses a QSB account
 * request. The UI's copy table matches each one exactly, so changing one here
 * changes both sides.
 */
export const QSB_ACCOUNT_REFUSALS = {
  accountLimit: "qsb account limit reached",
  backupMismatch: "qsb backup words do not match",
  creationFailed: "qsb account could not be created",
  duplicatePhrase: "qsb phrase is already in this wallet",
  invalidPhrase: "invalid qsb recovery phrase",
  journalUnavailable: "qsb journal is unavailable",
  notDedicated: "qsb phrase is a starknet recovery phrase",
  unknownAccount: "unknown qsb account",
} as const;
