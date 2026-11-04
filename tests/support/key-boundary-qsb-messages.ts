/**
 * Key-boundary catalog slice for the QSB account and vault messages, split
 * from ./key-boundary-messages by the size budget. All ten are extension-page
 * only. `wallet.revealQsbPhrase` is the one reply sanctioned to carry a QSB
 * phrase; the scan holds every other QSB reply to carrying no phrase, no
 * journal id, no `qsbAccounts` record, no owner key and no coordinator token.
 * The negative entries are here because a refusal must leak nothing either: a
 * wrong password on the reveal, a wrong word on the backup check, a deposit
 * at a fee other than the quoted one, and an unknown account's vaults.
 */
import {
  extensionSender,
  qsbAccount,
  SECRET_PASSPHRASE,
  SECRET_QSB_MNEMONIC,
} from "./key-boundary-fixtures";
import { KEY_BOUNDARY_QSB_AMOUNT, KEY_BOUNDARY_QSB_VAULT } from "./key-boundary-qsb-vaults";
import { QSB_IMPORT_MNEMONIC } from "./key-boundary-qsb-wallet";
import type { KeyBoundaryMessage } from "./key-boundary-types";

// The one deposit the vault entries quote and make.
const depositOf = {
  accountId: qsbAccount.id,
  amountSat: KEY_BOUNDARY_QSB_AMOUNT,
  v: KEY_BOUNDARY_QSB_VAULT,
} as const;

// Three distinct positions of the stub vault's QSB phrase, retyped.
const CHECK_POSITIONS = [0, 11, 23] as const;
const storedWords = SECRET_QSB_MNEMONIC.split(" ");
const retyped = CHECK_POSITIONS.map((index) => ({ index, word: storedWords[index] ?? "" }));

/** The QSB entries, live first, then the reviewed refusals. */
export const QSB_KEY_BOUNDARY_MESSAGES: readonly KeyBoundaryMessage[] = [
  { message: { type: "wallet.qsbAccounts" }, sender: extensionSender },
  { message: { type: "wallet.createQsbAccount" }, sender: extensionSender },
  {
    message: { mnemonic: QSB_IMPORT_MNEMONIC, type: "wallet.importQsbAccount" },
    sender: extensionSender,
  },
  {
    message: { accountId: qsbAccount.id, type: "wallet.confirmQsbBackup", words: retyped },
    sender: extensionSender,
  },
  {
    message: {
      accountId: qsbAccount.id,
      passphrase: SECRET_PASSPHRASE,
      type: "wallet.revealQsbPhrase",
    },
    sender: extensionSender,
  },
  {
    message: {
      accountId: qsbAccount.id,
      passphrase: "wrong passphrase!!",
      type: "wallet.revealQsbPhrase",
    },
    negative: "a wrong password must not reveal a QSB phrase, nor echo the vault",
    sender: extensionSender,
  },
  {
    message: {
      accountId: qsbAccount.id,
      type: "wallet.confirmQsbBackup",
      words: retyped.map((entry, position) =>
        position === 1 ? { ...entry, word: "abandon" } : entry,
      ),
    },
    negative: "a wrong backup word is refused without naming the word or the phrase",
    sender: extensionSender,
  },
  // The vault entries run in journey order over one fresh account: list,
  // create vault 0, quote it, deposit at the quoted fee, resend.
  { message: { accountId: qsbAccount.id, type: "wallet.qsbVaults" }, sender: extensionSender },
  { message: { accountId: qsbAccount.id, type: "wallet.createQsbVault" }, sender: extensionSender },
  {
    message: { ...depositOf, type: "wallet.quoteQsbDeposit" },
    sender: extensionSender,
  },
  {
    message: { ...depositOf, feeSat: 1, type: "wallet.depositQsbVault" },
    negative: "a deposit at a fee other than the quoted one signs nothing and names nothing",
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ feeSat: await ids.qsbDepositFee() }),
    message: { ...depositOf, feeSat: 0, type: "wallet.depositQsbVault" },
    sender: extensionSender,
  },
  {
    message: {
      accountId: qsbAccount.id,
      type: "wallet.resendQsbDeposit",
      v: KEY_BOUNDARY_QSB_VAULT,
    },
    sender: extensionSender,
  },
  {
    message: { accountId: "qsb-9", type: "wallet.qsbVaults" },
    negative: "an unknown account is refused without opening any vault or naming one",
    sender: extensionSender,
  },
];
