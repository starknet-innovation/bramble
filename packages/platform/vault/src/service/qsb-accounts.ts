/**
 * Vault service methods for Quantum Safe Bitcoin (QSB) accounts, split from
 * ./service by behaviour. They follow the "QSB Wallet Secret Management" BIP
 * (profile QSB-HORS-v1): one dedicated 24-word phrase per account, never a
 * Starknet phrase; a phrase generated here makes this vault its only writer;
 * an imported phrase stays read-only for life; and a journal that is missing
 * or unreadable fails closed.
 *
 * Trust boundary: background-only, like the rest of the vault service, which
 * runs every method here inside its mutation queue, so no QSB write overlaps
 * another vault or journal write. Phrases come from Krusty and are checked by
 * Krusty; nothing here generates or validates one itself. Every reply is a
 * `QsbAccountView` except the phrase `revealQsbPhrase` returns after the vault
 * decrypted under the password the caller re-entered.
 */
import { RefusedBeforeWrite, WalletError } from "@bramble/core/errors";
import { isMnemonicText } from "@bramble/wallet-model/passphrase";
import {
  QSB_ACCOUNT_REFUSALS,
  QSB_BACKUP_CHECK_WORDS,
  type QsbAccountView,
} from "@bramble/wallet-model/qsb";
import type { EncryptedStore } from "../encrypted-store";
import type { KmsPort } from "../kms-port";
import {
  canonicalQsbPhrase,
  isQsbMnemonic,
  nextQsbAccountId,
  QSB_PHRASE_WORDS,
  type QsbAccountRecord,
} from "../qsb/qsb-account";
import { bindQsbJournal, type QsbJournalRead, qsbAccountView } from "../qsb/qsb-journal-record";
import { planQsbAccountCreation, readQsbJournal, writeQsbJournal } from "../qsb/qsb-journal-store";
import { QSB_NETWORK } from "../qsb/qsb-vault-record";
import { starknetPhrases, type Vault } from "../schema/schema";
import type { QsbAccountService, QsbAccountWiring, QsbBackupWord } from "./qsb-account-types";
import { assertWritableVault, writeVault } from "./service-creation";

type QsbAccountDeps = {
  readonly encryptedStore: EncryptedStore;
  readonly kms: Pick<KmsPort, "generateMnemonic" | "validateMnemonic">;
  readonly readVaultSnapshot: (vaultPassphrase: string) => Promise<Vault>;
  readonly wiring: QsbAccountWiring | undefined;
};

type NamedRefusal = Exclude<keyof typeof QSB_ACCOUNT_REFUSALS, "creationFailed">;

// A named refusal, always raised before anything is written.
const refused = (refusal: NamedRefusal): RefusedBeforeWrite =>
  new RefusedBeforeWrite(QSB_ACCOUNT_REFUSALS[refusal]);

const creationFailed = (): WalletError => new WalletError(QSB_ACCOUNT_REFUSALS.creationFailed);

const NAMED_REFUSALS: ReadonlySet<string> = new Set(Object.values(QSB_ACCOUNT_REFUSALS));

// Creation and import answer every failure that is not a named refusal (a
// storage, Krusty or validation failure) with `creationFailed`, so no internal
// detail reaches the panel and there is one thing to retry.
const failingClosed = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof RefusedBeforeWrite && NAMED_REFUSALS.has(error.message)) {
      throw error;
    }
    throw creationFailed();
  }
};

// What one account's journal key holds. Never throws: no wiring, a store that
// cannot be opened, and a failed read are all `unreadable`, which binds as
// unavailable.
const readJournal = async (
  wiring: QsbAccountWiring | undefined,
  account: QsbAccountRecord,
  vaultPassphrase: string,
): Promise<QsbJournalRead> => {
  try {
    const store = wiring?.journals.forJournal(account.journalId);
    return store ? await readQsbJournal(store, vaultPassphrase) : { status: "unreadable" };
  } catch {
    return { status: "unreadable" };
  }
};

const viewOf = async (
  wiring: QsbAccountWiring | undefined,
  account: QsbAccountRecord,
  vaultPassphrase: string,
): Promise<QsbAccountView> =>
  qsbAccountView(bindQsbJournal(account, await readJournal(wiring, account, vaultPassphrase)));

const findQsbAccount = (vault: Vault, accountId: string): QsbAccountRecord => {
  const account = vault.qsbAccounts.find((held) => held.id === accountId);
  if (!account) {
    throw refused("unknownAccount");
  }
  return account;
};

const isPhrasePosition = (index: number): boolean =>
  Number.isSafeInteger(index) && index >= 0 && index < QSB_PHRASE_WORDS;

// Exactly QSB_BACKUP_CHECK_WORDS words at distinct positions, each equal to
// the stored word once trimmed and lowercased. The stored phrase is already in
// its canonical spelling. An empty or partial check never passes.
const matchesBackupWords = (mnemonic: string, words: readonly QsbBackupWord[]): boolean => {
  const stored = mnemonic.split(" ");
  return (
    words.length === QSB_BACKUP_CHECK_WORDS &&
    new Set(words.map((entry) => entry.index)).size === words.length &&
    words.every(
      (entry) =>
        isPhrasePosition(entry.index) &&
        typeof entry.word === "string" &&
        entry.word.trim().toLowerCase() === stored[entry.index],
    )
  );
};

// A QSB account is only added to a wallet that exists: a session over a
// missing vault reads as an empty one, which must not become a vault holding
// nothing but this account.
const existingVault = async (deps: QsbAccountDeps, vaultPassphrase: string): Promise<Vault> => {
  if (!(await deps.encryptedStore.exists())) {
    throw creationFailed();
  }
  return deps.readVaultSnapshot(vaultPassphrase);
};

const requireWiring = (wiring: QsbAccountWiring | undefined): QsbAccountWiring => {
  if (!wiring) {
    throw creationFailed();
  }
  return wiring;
};

const nextAccountId = (vault: Vault): string => {
  const id = nextQsbAccountId(vault.qsbAccounts);
  if (id === null) {
    throw refused("accountLimit");
  }
  return id;
};

// A new dedicated phrase, from Krusty alone, and only once Krusty has checked
// it: there is no fallback generation or validation.
const generatedPhrase = async (kms: QsbAccountDeps["kms"]): Promise<string> => {
  const phrase = await kms.generateMnemonic(QSB_PHRASE_WORDS);
  if (!isQsbMnemonic(phrase) || !(await kms.validateMnemonic(phrase))) {
    throw creationFailed();
  }
  return phrase;
};

// The phrase the user typed, in its stored spelling, once it has the QSB shape
// and Krusty accepts its words and checksum. A Krusty failure (as opposed to a
// verdict) is not a wrong phrase and reads as `creationFailed`.
const importablePhrase = async (kms: QsbAccountDeps["kms"], mnemonic: string): Promise<string> => {
  const phrase = isMnemonicText(mnemonic) ? canonicalQsbPhrase(mnemonic) : "";
  if (!isQsbMnemonic(phrase) || !(await kms.validateMnemonic(phrase))) {
    throw refused("invalidPhrase");
  }
  return phrase;
};

const requireDedicated = (vault: Vault, phrase: string): void => {
  if (vault.qsbAccounts.some((account) => canonicalQsbPhrase(account.mnemonic) === phrase)) {
    throw refused("duplicatePhrase");
  }
  if (starknetPhrases(vault).some((held) => canonicalQsbPhrase(held) === phrase)) {
    throw refused("notDedicated");
  }
};

// The planned writes, in the only safe order: the empty journal, then the vault
// naming it, stopping at the first failure. The vault is checked before the
// journal is written, so one that cannot take the account leaves no orphan; a
// vault write that still fails leaves the journal as an orphan nothing reads,
// and a retry draws a fresh journal id. Nothing after the vault write throws,
// so a reply of failure always means the account was not added.
const commitAccount = async (
  deps: QsbAccountDeps,
  wiring: QsbAccountWiring,
  vault: Vault,
  account: QsbAccountRecord,
  vaultPassphrase: string,
): Promise<QsbAccountView> => {
  const store = wiring.journals.forJournal(account.journalId);
  if (!store) {
    throw creationFailed();
  }
  const plan = planQsbAccountCreation({
    account,
    accounts: vault.qsbAccounts,
    journalSlot: (await store.exists()) ? "occupied" : "absent",
    otherPhrases: starknetPhrases(vault),
  });
  if (!plan.ok) {
    throw plan.refusal === "account-limit" ? refused("accountLimit") : creationFailed();
  }
  const [journalWrite, vaultWrite] = plan.writes;
  const next: Vault = { ...vault, qsbAccounts: vaultWrite.qsbAccounts };
  assertWritableVault(next);
  const written = await writeQsbJournal(
    store,
    account,
    journalWrite.journal,
    vaultPassphrase,
    "create",
  );
  if (!written.ok) {
    throw creationFailed();
  }
  await writeVault(deps.encryptedStore, next, vaultPassphrase);
  return qsbAccountView(bindQsbJournal(account, await readQsbJournal(store, vaultPassphrase)));
};

/**
 * Builds the QSB account methods over the vault's own snapshot read and
 * store. The caller runs each one inside its mutation queue and passes the
 * session's password everywhere except `revealQsbPhrase`.
 */
export const qsbAccountMethods = (deps: QsbAccountDeps): QsbAccountService => ({
  async confirmQsbBackup({ accountId, vaultPassphrase, words }) {
    const vault = await deps.readVaultSnapshot(vaultPassphrase);
    const account = findQsbAccount(vault, accountId);
    if (!matchesBackupWords(account.mnemonic, words)) {
      throw refused("backupMismatch");
    }
    if (account.seedContext.provenance !== "generated-here" || account.backupConfirmed) {
      return viewOf(deps.wiring, account, vaultPassphrase);
    }
    const confirmed: QsbAccountRecord = { ...account, backupConfirmed: true };
    const qsbAccounts = vault.qsbAccounts.map((held) =>
      held.id === account.id ? confirmed : held,
    );
    await writeVault(deps.encryptedStore, { ...vault, qsbAccounts }, vaultPassphrase);
    return viewOf(deps.wiring, confirmed, vaultPassphrase);
  },
  createQsbAccount: (vaultPassphrase) =>
    failingClosed(async () => {
      const wiring = requireWiring(deps.wiring);
      const vault = await existingVault(deps, vaultPassphrase);
      const id = nextAccountId(vault);
      const account: QsbAccountRecord = {
        backupConfirmed: false,
        id,
        journalId: wiring.drawJournalId(),
        mnemonic: await generatedPhrase(deps.kms),
        network: QSB_NETWORK,
        seedContext: { provenance: "generated-here", source: "bip39" },
      };
      return commitAccount(deps, wiring, vault, account, vaultPassphrase);
    }),
  importQsbAccount: ({ mnemonic, vaultPassphrase }) =>
    failingClosed(async () => {
      const wiring = requireWiring(deps.wiring);
      const phrase = await importablePhrase(deps.kms, mnemonic);
      const vault = await existingVault(deps, vaultPassphrase);
      requireDedicated(vault, phrase);
      const account: QsbAccountRecord = {
        // The user already holds this phrase, so there is no backup to make.
        backupConfirmed: true,
        id: nextAccountId(vault),
        journalId: wiring.drawJournalId(),
        mnemonic: phrase,
        network: QSB_NETWORK,
        seedContext: { provenance: "imported", source: "bip39" },
      };
      return commitAccount(deps, wiring, vault, account, vaultPassphrase);
    }),
  async qsbAccounts(vaultPassphrase) {
    const vault = await deps.readVaultSnapshot(vaultPassphrase);
    return Promise.all(
      vault.qsbAccounts.map((account) => viewOf(deps.wiring, account, vaultPassphrase)),
    );
  },
  async revealQsbPhrase({ accountId, vaultPassphrase }) {
    const vault = await deps.readVaultSnapshot(vaultPassphrase);
    return findQsbAccount(vault, accountId).mnemonic;
  },
});
