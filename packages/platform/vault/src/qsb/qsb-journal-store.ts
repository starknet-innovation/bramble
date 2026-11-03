/**
 * Where a QSB journal is stored, and the only orders in which it may be read,
 * created, and replaced.
 *
 * Each QSB account's journal is its own encrypted envelope in `storage.local`
 * at `bramble:qsb-journal:<journalId>`. One key per account keeps writes
 * small (a disclosure rewrites one journal, never the vault or another
 * account's) and gives each account its own blast radius: a corrupt or lost
 * journal fails closed for that account alone. The background root wires each
 * one with the same encrypted-store factory and options as the vault — same
 * `storage.local` area, `storage.sync` commit records, session shadow and
 * local mirror — and reads and writes it under the same vault passphrase. The
 * store binds every envelope to its key (the key is in the AES-GCM associated
 * data) and refuses a rolled-back envelope, which here is the BIP's "rolling
 * back history" hazard: an old journal would show an exposed key set as fresh.
 *
 * Journal writes must run inside the vault's existing mutation queue, so a
 * journal and the vault account naming it are never mutated concurrently, and
 * must be durable before anything the write authorizes is published.
 */
import { QSB_JOURNAL_MAX_BYTES } from "@bramble/core/json";
import { QSB_JOURNAL_KEY_PREFIX } from "@bramble/store/kv";
import type { EncryptedStore } from "../encrypted-store";
import {
  hasValidQsbAccounts,
  isQsbAccountRecord,
  isQsbJournalId,
  MAX_QSB_ACCOUNTS,
  type QsbAccountRecord,
} from "./qsb-account";
import {
  bindQsbJournal,
  emptyQsbJournal,
  type QsbJournal,
  type QsbJournalRead,
  qsbJournalBytes,
} from "./qsb-journal-record";

/**
 * The storage key of one account's journal, or null for anything that is not
 * a journal id, so no other key can ever be addressed as a journal.
 */
export const qsbJournalStorageKey = (journalId: string): string | null =>
  isQsbJournalId(journalId) ? `${QSB_JOURNAL_KEY_PREFIX}${journalId}` : null;

/**
 * Reads one account's journal envelope and classifies the outcome for
 * `bindQsbJournal`. Any failure to read — a malformed envelope, a missing or
 * contradicting commit record, a failed authentication or decryption — is
 * `unreadable`, so it fails closed; it is never treated as an empty journal.
 */
export const readQsbJournal = async (
  store: Pick<EncryptedStore, "read">,
  vaultPassphrase: string,
): Promise<QsbJournalRead> => {
  try {
    const value = await store.read(vaultPassphrase);
    return value === undefined ? { status: "missing" } : { status: "present", value };
  } catch {
    return { status: "unreadable" };
  }
};

/**
 * Why a journal write was refused before any storage was touched. A code, not
 * copy: `journal-full` (past `QSB_JOURNAL_MAX_BYTES`), `invalid-journal` (not
 * a valid journal bound to the account, or a non-empty creation),
 * `journal-exists` (a creation over an occupied key), `journal-missing` (a
 * replace over a key that holds nothing: a lost journal stays lost).
 */
export type QsbJournalWriteRefusal =
  | "invalid-journal"
  | "journal-exists"
  | "journal-full"
  | "journal-missing";

/** A durable journal write, or the reason it was refused before storage. */
export type QsbJournalWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: QsbJournalWriteRefusal };

const contentRefusal = (
  account: QsbAccountRecord,
  journal: QsbJournal,
  mode: "create" | "replace",
): QsbJournalWriteRefusal | null => {
  if (qsbJournalBytes(journal) > QSB_JOURNAL_MAX_BYTES) return "journal-full";
  if (bindQsbJournal(account, { status: "present", value: journal }).status !== "bound") {
    return "invalid-journal";
  }
  const empty = journal.nextV === 0 && journal.vaults.length === 0;
  return mode === "create" && !empty ? "invalid-journal" : null;
};

/**
 * Durably writes one account's journal, refusing before any storage is
 * touched: past the byte cap, or not a valid journal bound to `account`.
 * `create` writes only the empty journal and only to a key holding nothing;
 * `replace` writes only over a journal that is still there, so a journal lost
 * between read and write is never silently recreated. A failure of the
 * storage write itself still throws, as every encrypted-store write does.
 */
export const writeQsbJournal = async (
  store: Pick<EncryptedStore, "exists" | "write">,
  account: QsbAccountRecord,
  journal: QsbJournal,
  vaultPassphrase: string,
  mode: "create" | "replace",
): Promise<QsbJournalWriteResult> => {
  const refusal = contentRefusal(account, journal, mode);
  if (refusal !== null) return { ok: false, refusal };
  const exists = await store.exists();
  if (mode === "create" && exists) return { ok: false, refusal: "journal-exists" };
  if (mode === "replace" && !exists) return { ok: false, refusal: "journal-missing" };
  await store.write(journal, vaultPassphrase);
  return { ok: true };
};

/** Why a new QSB account cannot be created. A code, not copy. */
export type QsbAccountCreationRefusal =
  | "account-limit"
  | "duplicate-account"
  | "invalid-account"
  | "journal-exists";

/**
 * The writes that create one QSB account, in the only safe order: the empty
 * journal first (`create` mode), then the vault with the account appended.
 * Stop at the first failure. A vault write that fails after the journal write
 * leaves an orphan journal, which is harmless and never read; a retry draws a
 * fresh journal id rather than reusing an occupied key.
 */
export type QsbAccountCreationPlan =
  | {
      readonly ok: true;
      readonly writes: readonly [
        { readonly journal: QsbJournal; readonly key: string; readonly kind: "journal" },
        { readonly kind: "vault"; readonly qsbAccounts: readonly QsbAccountRecord[] },
      ];
    }
  | { readonly ok: false; readonly refusal: QsbAccountCreationRefusal };

/**
 * Plans the creation of `account` beside the vault's existing QSB accounts.
 * Refuses an invalid account or one whose phrase is not dedicated
 * (`otherPhrases` are the vault's Starknet phrases), a full collection, an id
 * or journal id already in use, and a journal key that already holds anything
 * (`journalSlot`, from the store's `exists`). Pure; the caller performs the
 * writes in order.
 */
export const planQsbAccountCreation = (input: {
  readonly account: QsbAccountRecord;
  readonly accounts: readonly QsbAccountRecord[];
  readonly journalSlot: "absent" | "occupied";
  readonly otherPhrases: readonly string[];
}): QsbAccountCreationPlan => {
  const { account, accounts } = input;
  const key = isQsbAccountRecord(account) ? qsbJournalStorageKey(account.journalId) : null;
  if (key === null) return { ok: false, refusal: "invalid-account" };
  if (accounts.length >= MAX_QSB_ACCOUNTS) return { ok: false, refusal: "account-limit" };
  if (accounts.some((held) => held.id === account.id || held.journalId === account.journalId)) {
    return { ok: false, refusal: "duplicate-account" };
  }
  const qsbAccounts = [...accounts, account];
  if (!hasValidQsbAccounts(qsbAccounts, input.otherPhrases)) {
    return { ok: false, refusal: "invalid-account" };
  }
  if (input.journalSlot !== "absent") return { ok: false, refusal: "journal-exists" };
  return {
    ok: true,
    writes: [
      { journal: emptyQsbJournal(account), key, kind: "journal" },
      { kind: "vault", qsbAccounts },
    ],
  };
};
