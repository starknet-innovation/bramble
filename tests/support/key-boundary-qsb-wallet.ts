/**
 * The key-boundary wallet double's QSB account methods, split from
 * ./key-boundary-collaborators by the size budget, plus the salted QSB secrets
 * the scan greps for beyond the stub vault's own phrase.
 *
 * Every view is built by the real `qsbAccountView` projection from a record
 * that holds a salted phrase and a real-shaped journal id, so a handler that
 * forwarded a record, or the vault, instead of its view would put a secret in
 * the reply the scan reads. Only `revealQsbPhrase` hands a phrase out, and
 * only with the stub vault's password, as the real service does.
 */
import { createHash } from "node:crypto";
import { WalletError } from "@bramble/core/errors";
import type { QsbAccountRecord } from "@bramble/vault/qsb-account";
import { bindQsbJournal, emptyQsbJournal, qsbAccountView } from "@bramble/vault/qsb-journal-record";
import type { QsbAccountService } from "@bramble/vault/service-types";
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { qsbAccount, SECRET_PASSPHRASE, SECRET_QSB_MNEMONIC } from "./key-boundary-fixtures";

const journalId = (label: string): string =>
  createHash("sha256").update(`key-boundary qsb journal ${label}`).digest("hex");

/**
 * The phrase the double's `createQsbAccount` stands for having generated: a
 * published BIP-39 24-word test vector, public and never for funds.
 */
export const SECRET_QSB_GENERATED_MNEMONIC =
  "void come effort suffer camp survey warrior heavy shoot primary clutch crush open amazing screen patrol group space point ten exist slush involve unfold";

/**
 * The phrase the catalog's import entry sends: another published BIP-39
 * 24-word test vector. A reply must never echo it back.
 */
export const QSB_IMPORT_MNEMONIC =
  "panda eyebrow bullet gorilla call smoke muffin taste mesh discover soft ostrich alcohol speed nation flash devote level hobby quick inner drive ghost inside";

const generatedAccount: QsbAccountRecord = {
  backupConfirmed: false,
  id: "qsb-2",
  journalId: journalId("generated"),
  mnemonic: SECRET_QSB_GENERATED_MNEMONIC,
  network: "bitcoin-mainnet",
  seedContext: { provenance: "generated-here", source: "bip39" },
};

const importedAccount: QsbAccountRecord = {
  backupConfirmed: true,
  id: "qsb-3",
  journalId: journalId("imported"),
  mnemonic: QSB_IMPORT_MNEMONIC,
  network: "bitcoin-mainnet",
  seedContext: { provenance: "imported", source: "bip39" },
};

/** Every journal id the double's QSB records hold; none may reach a reply. */
export const KEY_BOUNDARY_QSB_JOURNAL_IDS: readonly string[] = [
  qsbAccount.journalId,
  generatedAccount.journalId,
  importedAccount.journalId,
];

const viewOf = (account: QsbAccountRecord) =>
  qsbAccountView(bindQsbJournal(account, { status: "present", value: emptyQsbJournal(account) }));

const requirePassphrase = (vaultPassphrase: string): void => {
  if (vaultPassphrase !== SECRET_PASSPHRASE) {
    throw new Error("bad passphrase");
  }
};

const requireStubAccount = (accountId: string): void => {
  if (accountId !== qsbAccount.id) {
    throw new WalletError(QSB_ACCOUNT_REFUSALS.unknownAccount);
  }
};

/** The double's QSB methods, over the stub vault's one QSB account. */
export const qsbWalletStub: QsbAccountService = {
  async confirmQsbBackup({ accountId, vaultPassphrase, words }) {
    requirePassphrase(vaultPassphrase);
    requireStubAccount(accountId);
    const stored = SECRET_QSB_MNEMONIC.split(" ");
    if (!words.every((entry) => entry.word.trim().toLowerCase() === stored[entry.index])) {
      throw new WalletError(QSB_ACCOUNT_REFUSALS.backupMismatch);
    }
    return viewOf(qsbAccount);
  },
  async createQsbAccount(vaultPassphrase) {
    requirePassphrase(vaultPassphrase);
    return viewOf(generatedAccount);
  },
  async importQsbAccount({ vaultPassphrase }) {
    requirePassphrase(vaultPassphrase);
    return viewOf(importedAccount);
  },
  async qsbAccounts(vaultPassphrase) {
    requirePassphrase(vaultPassphrase);
    return [qsbAccount, generatedAccount, importedAccount].map(viewOf);
  },
  // The one sanctioned QSB reveal, gated on the password like the real one.
  async revealQsbPhrase({ accountId, vaultPassphrase }) {
    requirePassphrase(vaultPassphrase);
    requireStubAccount(accountId);
    return SECRET_QSB_MNEMONIC;
  },
};
