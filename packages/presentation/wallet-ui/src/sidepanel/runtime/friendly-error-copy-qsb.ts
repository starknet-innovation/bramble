/**
 * Reader-facing sentences for Quantum Safe Bitcoin accounts, consumed by the
 * main table in ./friendly-error-copy. Split from it by the size budget; same
 * contract: exact lowercase diagnostic to sentence.
 */
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";

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
  // Vaults and deposits.
  [QSB_VAULT_REFUSALS.amountTooSmall, "Deposit at least 0.0001 BTC."],
  [QSB_VAULT_REFUSALS.coordinatorDisabled, "Quantum-safe deposits are switched off right now."],
  [
    QSB_VAULT_REFUSALS.coordinatorUnavailable,
    "Couldn't reach the quantum-safe Bitcoin service. Try again.",
  ],
  [
    QSB_VAULT_REFUSALS.depositPending,
    "This vault already has a deposit waiting. Resend it instead.",
  ],
  [QSB_VAULT_REFUSALS.insufficientFunds, "Not enough bitcoin for this deposit and its fee."],
  [QSB_VAULT_REFUSALS.minerRateUnavailable, "Couldn't get the miner's fee rate. Try again."],
  [QSB_VAULT_REFUSALS.notDepositable, "This vault can't take a deposit."],
  [QSB_VAULT_REFUSALS.notWriter, "Only a backed-up account created here can make vaults."],
  [QSB_VAULT_REFUSALS.quoteChanged, "The cost changed. Review the new quote."],
  [QSB_VAULT_REFUSALS.runtimeUnavailable, "Couldn't build the vault. Try again."],
  [QSB_VAULT_REFUSALS.scriptTaken, "This vault can't be used. Create a new one."],
  [QSB_VAULT_REFUSALS.signInRefused, "Couldn't sign in to the quantum-safe Bitcoin service."],
  [QSB_VAULT_REFUSALS.unknownVault, "That vault isn't in this account."],
  [QSB_VAULT_REFUSALS.vaultLimit, "This account already holds as many vaults as it can."],
];
