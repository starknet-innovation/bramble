/**
 * Quantum Safe Bitcoin (QSB) account records as the encrypted vault keeps
 * them: account-level data only — the dedicated BIP-39 phrase, its
 * provenance, the backup flag, and the `journalId` naming this account's
 * disclosure journal. The journal itself (high-water mark and vault records,
 * per the "QSB Wallet Secret Management" BIP, profile QSB-HORS-v1) lives in
 * its own encrypted storage key with its own budget (`./qsb-journal-record`,
 * `./qsb-journal-store`), so a full journal can never fill the vault.
 *
 * Vault-internal data: the phrase never leaves the encrypted vault. HORS
 * secrets are never stored anywhere; Krusty derives commitments and releases
 * preimages on demand. Validators only, total and fail-closed: a vault holding
 * a malformed, duplicated, or shared-phrase account fails closed like any
 * other corrupt vault content.
 */
import { hasOnlyKnownKeys, hasUniqueStrings, isRecord } from "@bramble/core/json";
import { isMnemonicText } from "@bramble/wallet-model/passphrase";
import { isQsbHash32, QSB_NETWORK } from "./qsb-vault-record";

/** Words in a dedicated QSB phrase: 24, so it carries 256 bits of entropy. */
export const QSB_PHRASE_WORDS = 24;

/**
 * Most QSB accounts one vault keeps. A further account is refused, never
 * evicting one: each holds the only copy of its phrase here. Together with
 * the journal byte cap it bounds what all journals can take at rest.
 */
export const MAX_QSB_ACCOUNTS = 8;

/**
 * Where the phrase came from. `generated-here` is a phrase Krusty generated in
 * this vault, so this vault is its only possible writer; `imported` arrived
 * from elsewhere and is read-only, because another copy may have disclosed.
 */
export type QsbSeedContext = {
  readonly provenance: "generated-here" | "imported";
  readonly source: "bip39";
};

/**
 * One QSB account as the vault stores it. `journalId` is a random 256-bit
 * handle (drawn at the background's randomness boundary when the account is
 * created) naming the one journal this account may ever bind: account ids
 * repeat after a wallet reset, journal ids never do.
 */
export type QsbAccountRecord = {
  readonly backupConfirmed: boolean;
  readonly id: string;
  readonly journalId: string;
  readonly mnemonic: string;
  readonly network: typeof QSB_NETWORK;
  readonly seedContext: QsbSeedContext;
};

const QSB_ACCOUNT_ID_PATTERN = /^qsb-[1-9][0-9]{0,3}$/;
const PHRASE_WORD_PATTERN = /^[a-z]+$/;

/**
 * Checks a QSB account id: `qsb-<n>`, n in 1..9999, allocated in sequence by
 * the vault. It carries no `:`, so it can never parse as a Starknet
 * `networkId:felt` account id, nor as an imported-phrase handle. It repeats
 * across wallet resets, so it never selects a journal on its own.
 */
export const isQsbAccountId = (value: unknown): value is string =>
  typeof value === "string" && QSB_ACCOUNT_ID_PATTERN.test(value);

/**
 * Checks a journal id: 64 lowercase hex digits (32 random bytes). Validation
 * only; the value is drawn by the background, never derived here.
 */
export const isQsbJournalId = (value: unknown): value is string => isQsbHash32(value);

/**
 * The next id for a new QSB account: one past the highest in use, so an id is
 * never reused while its predecessor is kept. Null once the account bound or
 * the id grammar is exhausted; the caller refuses the new account.
 */
export const nextQsbAccountId = (accounts: readonly { readonly id: string }[]): string | null => {
  const highest = Math.max(0, ...accounts.map((account) => Number(account.id.slice(4))));
  const id = `qsb-${highest + 1}`;
  return accounts.length < MAX_QSB_ACCOUNTS && isQsbAccountId(id) ? id : null;
};

/**
 * Checks the stored spelling of a dedicated QSB phrase: the shared bounded
 * phrase-text grammar, exactly 24 lowercase words joined by single spaces. One
 * phrase has one stored spelling, so two accounts holding the same one are
 * detectable. Word-list membership and the checksum remain Krusty's to check.
 */
export const isQsbMnemonic = (value: unknown): value is string => {
  if (!isMnemonicText(value)) {
    return false;
  }
  const words = value.split(" ");
  return words.length === QSB_PHRASE_WORDS && words.every((word) => PHRASE_WORD_PATTERN.test(word));
};

const isSeedContext = (value: unknown): value is QsbSeedContext =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["provenance", "source"]) &&
  (value["provenance"] === "generated-here" || value["provenance"] === "imported") &&
  value["source"] === "bip39";

const ACCOUNT_KEYS = [
  "backupConfirmed",
  "id",
  "journalId",
  "mnemonic",
  "network",
  "seedContext",
] as const;

/**
 * Validates one QSB account record's fields. Journal-dependent rules (writer
 * status, provenance limits on the records) are checked when its journal is
 * bound (`bindQsbJournal`); uniqueness by {@link hasValidQsbAccounts}.
 */
export const isQsbAccountRecord = (value: unknown): value is QsbAccountRecord =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ACCOUNT_KEYS) &&
  isQsbAccountId(value["id"]) &&
  isQsbJournalId(value["journalId"]) &&
  isQsbMnemonic(value["mnemonic"]) &&
  isSeedContext(value["seedContext"]) &&
  typeof value["backupConfirmed"] === "boolean" &&
  value["network"] === QSB_NETWORK;

// Whitespace-insensitive, case-folded, NFKD word sequence, so a phrase stored
// with other spacing still collides with its QSB twin.
const phraseKey = (phrase: string): string =>
  phrase.normalize("NFKD").toLowerCase().trim().split(/\s+/).join(" ");

/**
 * Validates the vault's whole QSB collection: within the account bound, every
 * account valid, ids and journal ids distinct, and every phrase dedicated —
 * not held by a second QSB account (two journals for one phrase would be two
 * writers) and not one of the vault's Starknet phrases (`otherPhrases`).
 */
export const hasValidQsbAccounts = (
  accounts: unknown,
  otherPhrases: readonly string[],
): accounts is readonly QsbAccountRecord[] => {
  if (
    !Array.isArray(accounts) ||
    accounts.length > MAX_QSB_ACCOUNTS ||
    !accounts.every(isQsbAccountRecord)
  ) {
    return false;
  }
  const phrases = accounts.map((account) => phraseKey(account.mnemonic));
  const others = new Set(otherPhrases.map(phraseKey));
  return (
    hasUniqueStrings(accounts.map((account) => account.id)) &&
    hasUniqueStrings(accounts.map((account) => account.journalId)) &&
    hasUniqueStrings(phrases) &&
    phrases.every((phrase) => !others.has(phrase))
  );
};
