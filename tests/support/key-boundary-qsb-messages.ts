/**
 * Key-boundary catalog slice for the QSB account messages, split from
 * ./key-boundary-messages by the size budget. All five are extension-page
 * only. `wallet.revealQsbPhrase` is the one reply sanctioned to carry a QSB
 * phrase; the scan holds every other QSB reply to carrying no phrase, no
 * journal id and no `qsbAccounts` record. The two negative entries are here
 * because a refusal must leak nothing either: a wrong password on the reveal,
 * and a wrong word on the backup check.
 */
import {
  extensionSender,
  qsbAccount,
  SECRET_PASSPHRASE,
  SECRET_QSB_MNEMONIC,
} from "./key-boundary-fixtures";
import { QSB_IMPORT_MNEMONIC } from "./key-boundary-qsb-wallet";
import type { KeyBoundaryMessage } from "./key-boundary-types";

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
];
