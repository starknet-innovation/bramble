/**
 * Reader-facing sentences for Quantum Safe Bitcoin accounts, consumed by the
 * main table in ./friendly-error-copy. Split from it by the size budget; same
 * contract: exact lowercase diagnostic to sentence.
 */
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";

/** QSB account entries merged into ERROR_COPY, in table order. */
export const QSB_ERROR_COPY: readonly (readonly [string, string])[] = [
  [
    QSB_ACCOUNT_REFUSALS.accountLimit,
    "This wallet already holds as many quantum-safe Bitcoin accounts as it can.",
  ],
  [
    QSB_ACCOUNT_REFUSALS.backupMismatch,
    "Those words don't match your phrase. Check them and try again.",
  ],
  [QSB_ACCOUNT_REFUSALS.creationFailed, "Couldn't create the account. Try again."],
  [QSB_ACCOUNT_REFUSALS.duplicatePhrase, "This phrase is already in this wallet."],
  [QSB_ACCOUNT_REFUSALS.invalidPhrase, "That isn't a valid 24-word phrase. Check each word."],
  // A missing or unreadable journal is the one state where Bramble cannot know
  // which keys were already revealed, so it releases none.
  [
    QSB_ACCOUNT_REFUSALS.journalUnavailable,
    "Bramble can't read this account's history, so it won't release any of its keys.",
  ],
  [
    QSB_ACCOUNT_REFUSALS.notDedicated,
    "This is your Starknet recovery phrase. Bitcoin vaults need a phrase of their own.",
  ],
  [QSB_ACCOUNT_REFUSALS.unknownAccount, "That account isn't in this wallet."],
];
