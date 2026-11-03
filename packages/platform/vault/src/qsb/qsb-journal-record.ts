/**
 * The QSB disclosure journal: one separately versioned record per QSB account,
 * kept in its own authenticated-encrypted storage key (`./qsb-journal-store`)
 * rather than in the vault, under its own byte cap. It holds the BIP's
 * allocation high-water mark and vault records ("QSB Wallet Secret
 * Management", profile QSB-HORS-v1) and a header binding it to exactly one
 * vault account: `accountId` and the random `journalId`.
 *
 * The phrase and the journal no longer change in one atomic write, so two
 * rules carry the safety the shared write used to:
 *
 * - Creation order: the empty journal is written before the vault account
 *   that names it. A journal left without an account is an orphan: nothing
 *   reads it (journals are only looked up by an account's `journalId`), so it
 *   is harmless and ignored.
 * - Fail closed: an account whose journal is missing, unreadable, invalid, or
 *   bound to another account or journal id is not a writer, and every
 *   transition on it is refused. Nothing recreates an empty journal over a
 *   lost one; only account creation ever produces one.
 *
 * Pure: no clock, randomness, storage, or network. The journal holds no
 * phrase, but it reveals which Bitcoin vaults someone holds, so it stays out
 * of messages, UI state, logs, and session storage like any vault data.
 */
import { hasOnlyKnownKeys, isRecord, QSB_JOURNAL_MAX_BYTES } from "@bramble/core/json";
import { isQsbAccountId, isQsbJournalId, type QsbAccountRecord } from "./qsb-account";
import {
  isQsbHighWaterMark,
  isQsbJournalOrder,
  isQsbVaultRecord,
  QSB_NETWORK,
  QSB_PROFILE,
  type QsbVaultRecord,
} from "./qsb-vault-record";

/**
 * The journal record's own schema version, independent of the vault's. A
 * future shape bumps it and adds one adjacent, deterministic migration, as the
 * vault does; until then any other version is refused.
 */
export const QSB_JOURNAL_SCHEMA_VERSION = 1;

/**
 * One account's journal. `accountId`, `journalId`, `network`, `profile`, and
 * `schemaVersion` are the header; `nextV` is the allocation high-water mark
 * (every index below it is reserved for good, whether or not a record for it
 * is still kept) and `vaults` the records, strictly ascending by `v`.
 */
export type QsbJournal = {
  readonly accountId: string;
  readonly journalId: string;
  readonly network: typeof QSB_NETWORK;
  readonly nextV: number;
  readonly profile: typeof QSB_PROFILE;
  readonly schemaVersion: typeof QSB_JOURNAL_SCHEMA_VERSION;
  readonly vaults: readonly QsbVaultRecord[];
};

const JOURNAL_KEYS = [
  "accountId",
  "journalId",
  "network",
  "nextV",
  "profile",
  "schemaVersion",
  "vaults",
] as const;

const hasJournalFields = (value: Record<string, unknown>): boolean =>
  hasOnlyKnownKeys(value, JOURNAL_KEYS) &&
  value["schemaVersion"] === QSB_JOURNAL_SCHEMA_VERSION &&
  isQsbAccountId(value["accountId"]) &&
  isQsbJournalId(value["journalId"]) &&
  value["network"] === QSB_NETWORK &&
  value["profile"] === QSB_PROFILE &&
  isQsbHighWaterMark(value["nextV"]) &&
  Array.isArray(value["vaults"]) &&
  value["vaults"].every(isQsbVaultRecord);

/**
 * Exact serialized size of a journal, in bytes: the plaintext the encrypted
 * store writes. Every field of a valid journal is ASCII, so the string length
 * is the UTF-8 size.
 */
export const qsbJournalBytes = (journal: QsbJournal): number => JSON.stringify(journal).length;

/**
 * Validates a journal: the header, every vault record, strictly ascending
 * indices below `nextV` within the record bound, and the byte cap
 * (`QSB_JOURNAL_MAX_BYTES`). A journal past any limit is invalid, never
 * truncated. Binding to an account is checked by {@link bindQsbJournal}.
 */
export const isQsbJournal = (value: unknown): value is QsbJournal => {
  if (!isRecord(value) || !hasJournalFields(value)) {
    return false;
  }
  const journal = value as unknown as QsbJournal;
  return (
    isQsbJournalOrder(journal.vaults, journal.nextV) &&
    qsbJournalBytes(journal) <= QSB_JOURNAL_MAX_BYTES
  );
};

/**
 * The empty journal a new account starts with: bound to its id and journal
 * id, `nextV` 0, no records. Only account creation may write it, and only to
 * a key that holds nothing (see `planQsbAccountCreation`).
 */
export const emptyQsbJournal = (
  account: Pick<QsbAccountRecord, "id" | "journalId">,
): QsbJournal => ({
  accountId: account.id,
  journalId: account.journalId,
  network: QSB_NETWORK,
  nextV: 0,
  profile: QSB_PROFILE,
  schemaVersion: QSB_JOURNAL_SCHEMA_VERSION,
  vaults: [],
});

/**
 * What reading an account's journal key produced: nothing stored, a stored
 * envelope that could not be read (malformed, rolled back, failing
 * authentication or decryption), or a decrypted value still to be validated.
 */
export type QsbJournalRead =
  | { readonly status: "missing" }
  | { readonly status: "present"; readonly value: unknown }
  | { readonly status: "unreadable" };

/** Why an account's journal is unavailable; every reason fails closed alike. */
export type QsbJournalUnavailable = "invalid" | "mismatched" | "missing" | "unreadable";

/**
 * An account with its journal bound, or the reason it has none. Every
 * transition takes one of these, so none can run on an unbound journal.
 */
export type QsbJournalBinding =
  | {
      readonly account: QsbAccountRecord;
      readonly journal: QsbJournal;
      readonly status: "bound";
    }
  | {
      readonly account: QsbAccountRecord;
      readonly reason: QsbJournalUnavailable;
      readonly status: "unavailable";
    };

/** The bound half of a {@link QsbJournalBinding}. */
export type BoundQsbJournal = Extract<QsbJournalBinding, { readonly status: "bound" }>;

const matchesAccount = (journal: QsbJournal, account: QsbAccountRecord): boolean =>
  journal.accountId === account.id &&
  journal.journalId === account.journalId &&
  journal.network === account.network;

// Bramble's writer rules, checked across the two records: an imported journal
// never holds a key set it could still disclose from, and nothing is
// allocated before the user has confirmed the phrase backup.
const respectsProvenance = (journal: QsbJournal, account: QsbAccountRecord): boolean => {
  if (account.seedContext.provenance === "imported") {
    return journal.vaults.every((vault) => vault.state === "retired" || vault.state === "unknown");
  }
  return account.backupConfirmed || (journal.nextV === 0 && journal.vaults.length === 0);
};

/**
 * Binds an account to what its journal key held. Bound only when the value is
 * a valid journal whose header names this exact account and journal id and
 * whose records respect the account's provenance; otherwise unavailable, with
 * the reason. Total and fail-closed: an unavailable journal is never replaced
 * by an empty one here or anywhere else.
 */
export const bindQsbJournal = (
  account: QsbAccountRecord,
  read: QsbJournalRead,
): QsbJournalBinding => {
  const unavailable = (reason: QsbJournalUnavailable): QsbJournalBinding => ({
    account,
    reason,
    status: "unavailable",
  });
  if (read.status !== "present") {
    return unavailable(read.status);
  }
  if (!isQsbJournal(read.value)) {
    return unavailable("invalid");
  }
  if (!matchesAccount(read.value, account)) {
    return unavailable("mismatched");
  }
  return respectsProvenance(read.value, account)
    ? { account, journal: read.value, status: "bound" }
    : unavailable("invalid");
};

/**
 * The one definition of writer status: the phrase was generated in this vault
 * (so no other copy can be writing), the user confirmed its backup, and its
 * journal is present and bound. Only a writer may allocate or disclose.
 */
export const isQsbWriter = (binding: QsbJournalBinding): boolean =>
  binding.status === "bound" &&
  binding.account.seedContext.provenance === "generated-here" &&
  binding.account.backupConfirmed;
