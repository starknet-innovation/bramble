/**
 * Reader-facing sentences for QSB vaults and their deposits, consumed by the
 * main table in ./friendly-error-copy. Split from it by the size budget; same
 * contract: exact lowercase diagnostic to sentence.
 */
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { QSB_WITHDRAWAL_REFUSALS } from "@bramble/wallet-model/qsb-withdrawals";

/** QSB account entries merged into ERROR_COPY, in table order. */
export const QSB_ERROR_COPY: readonly (readonly [string, string])[] = [
  [QSB_ACCOUNT_REFUSALS.accountLimit, "This wallet already holds as many QSB vaults as it can."],
  [
    QSB_ACCOUNT_REFUSALS.backupMismatch,
    "Those words don't match your phrase. Check them and try again.",
  ],
  [QSB_ACCOUNT_REFUSALS.creationFailed, "Couldn't create the QSB vault. Try again."],
  [QSB_ACCOUNT_REFUSALS.duplicatePhrase, "This phrase is already in this wallet."],
  [QSB_ACCOUNT_REFUSALS.invalidPhrase, "That isn't a valid 24-word phrase. Check each word."],
  // A missing or unreadable journal is the one state where Bramble cannot know
  // which keys were already revealed, so it releases none.
  [
    QSB_ACCOUNT_REFUSALS.journalUnavailable,
    "Bramble can't read this QSB vault's history right now.",
  ],
  [
    QSB_ACCOUNT_REFUSALS.notDedicated,
    "This is your Starknet recovery phrase. A QSB vault needs a phrase of its own.",
  ],
  [QSB_ACCOUNT_REFUSALS.unknownAccount, "That QSB vault isn't in this wallet."],
  // Vaults and deposits.
  [QSB_VAULT_REFUSALS.accessNeeded, "Allow Bramble to reach the QSB service to continue."],
  [QSB_VAULT_REFUSALS.amountTooSmall, "Deposit at least 0.0001 BTC."],
  [QSB_VAULT_REFUSALS.coordinatorDisabled, "QSB deposits are switched off right now."],
  [QSB_VAULT_REFUSALS.coordinatorUnavailable, "Couldn't reach the QSB service. Try again."],
  [QSB_VAULT_REFUSALS.depositPending, "A deposit is already waiting to be sent. Resend it first."],
  [QSB_VAULT_REFUSALS.insufficientFunds, "Not enough bitcoin for this deposit and its fee."],
  [QSB_VAULT_REFUSALS.minerRateUnavailable, "Couldn't get the miner's fee rate. Try again."],
  [QSB_VAULT_REFUSALS.notDepositable, "This deposit can't be funded."],
  [
    QSB_VAULT_REFUSALS.notWriter,
    "Only a QSB vault created here, with its phrase backed up, can take new deposits.",
  ],
  [QSB_VAULT_REFUSALS.quoteChanged, "The cost changed. Review the new quote."],
  [QSB_VAULT_REFUSALS.runtimeUnavailable, "Couldn't prepare the deposit. Try again."],
  [QSB_VAULT_REFUSALS.scriptTaken, "This deposit can't be used. Create a new one."],
  [QSB_VAULT_REFUSALS.signInRefused, "Couldn't sign in to the QSB service."],
  [QSB_VAULT_REFUSALS.unknownVault, "That deposit isn't in this QSB vault."],
  [QSB_VAULT_REFUSALS.vaultLimit, "This QSB vault already holds as many deposits as it can."],
  // Withdrawals.
  [
    QSB_WITHDRAWAL_REFUSALS.bindingRefused,
    "This withdrawal doesn't check out, so Bramble released nothing.",
  ],
  [QSB_WITHDRAWAL_REFUSALS.destinationInvalid, "Enter a Bitcoin mainnet address."],
  [QSB_WITHDRAWAL_REFUSALS.dustOutput, "This deposit is too small to withdraw after fees."],
  [
    QSB_WITHDRAWAL_REFUSALS.floorRisen,
    "Miner fees rose above this withdrawal's fee. Try again later.",
  ],
  [
    QSB_WITHDRAWAL_REFUSALS.helperNeeded,
    "Send a little bitcoin to this QSB vault's address first. A withdrawal needs it.",
  ],
  [QSB_WITHDRAWAL_REFUSALS.jobRefused, "The QSB service refused this withdrawal."],
  [QSB_WITHDRAWAL_REFUSALS.notReady, "This withdrawal isn't ready to release yet."],
  [QSB_WITHDRAWAL_REFUSALS.notWithdrawable, "This deposit can't be withdrawn."],
  [QSB_WITHDRAWAL_REFUSALS.quoteChanged, "The cost changed. Review the new quote."],
  [QSB_WITHDRAWAL_REFUSALS.reviewChanged, "The withdrawal changed. Review it again."],
  // Not a refusal: the background's answer (`QSB_WITHDRAWAL_OUTCOME_UNKNOWN`)
  // when secrets were released but no transaction could be built from them.
  // The deposit stays ready, and releasing again repeats the same release.
  [
    "qsb withdrawal outcome unknown",
    "Bramble couldn't finish this withdrawal. Check its status, then release it again.",
  ],
];
