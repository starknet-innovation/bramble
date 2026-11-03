/**
 * Quantum Safe Bitcoin (QSB) account records: a dedicated BIP-39 phrase and
 * the disclosure journal the "QSB Wallet Secret Management" BIP (profile
 * QSB-HORS-v1) requires beside it. A vault key set is one deposit and one
 * withdrawal, locked by 2 x 150 one-time HORS secrets; a withdrawal discloses 8
 * round-0 and 7 round-1 preimages, after which that key set is spent for good.
 *
 * Vault-internal data. The phrase never leaves the encrypted vault, and the
 * journal lives beside it so both change in one atomic write. HORS secrets are
 * never stored: Krusty derives commitments and releases preimages on demand,
 * and the background must durably record `exposed` before it releases any.
 *
 * Validators only, total and fail-closed: any malformed, unbounded, or
 * internally inconsistent record makes the value invalid, and a vault holding
 * one fails closed like any other corrupt vault content. Cryptographic facts
 * (that a root derives from the phrase, a script hashes to its hash, a digest
 * binds its transaction) are not checkable here and are re-established by the
 * background through Krusty.
 */
import { isLowercaseHexBytes } from "@bramble/core/hex";
import { hasOnlyKnownKeys, hasUniqueStrings, isRecord } from "@bramble/core/json";
import { isMnemonicText } from "@bramble/wallet-model/passphrase";
import { spendsOutpointOnce } from "./qsb-transaction";

/** The derivation profile every record in this schema follows. */
export const QSB_PROFILE = "QSB-HORS-v1";

/** The only network the profile holds portable state for (namespace `0x00`). */
export const QSB_NETWORK = "bitcoin-mainnet";

/** Exclusive bound on a vault index and inclusive bound on `nextV`: 2^31. */
export const QSB_VAULT_INDEX_LIMIT = 2 ** 31;

/** HORS secrets per round; disclosure indices lie in `[0, 150)`. */
export const QSB_SECRETS_PER_ROUND = 150;

/** Distinct indices one disclosure reveals from round 0 and from round 1. */
export const QSB_DISCLOSURE_COUNTS = { round0: 8, round1: 7 } as const;

/** Longest vault `scriptPubKey`, in bytes, the BIP admits. */
export const QSB_MAX_SCRIPT_BYTES = 10_000;

/**
 * Longest binding transaction `T`, in bytes, this wallet keeps. A resource
 * bound the BIP permits ("explicit refusal, never truncation"): `T` carries no
 * scriptSig or witness, so this still admits hundreds of inputs and outputs.
 */
export const QSB_MAX_TRANSACTION_BYTES = 10_000;

/** Largest satoshi amount a funding record may claim: 21 million BTC. */
export const QSB_MAX_VALUE_SAT = 2_100_000_000_000_000;

/** Words in a dedicated QSB phrase: 24, so it carries 256 bits of entropy. */
export const QSB_PHRASE_WORDS = 24;

/**
 * Most QSB accounts one vault keeps. A further account is refused, never
 * evicting one: each record is the only journal of its phrase.
 */
export const MAX_QSB_ACCOUNTS = 8;

/**
 * Most vault records one QSB account keeps. A further allocation or import is
 * refused, never evicting a record: a forgotten record is a key set that could
 * be mistaken for unused. The vault's JSON budget is shared and may refuse
 * earlier — a full-size script costs about a tenth of it.
 */
export const MAX_QSB_VAULTS_PER_ACCOUNT = 64;

/**
 * Disclosure state of one vault key set, as the BIP defines it: `allocated`
 * (reserved, never disclosed), `exposed` (a disclosure is durably committed),
 * `retired` (no further disclosure, ever), `unknown` (history missing, stale,
 * or conflicting; refuse until trustworthy history exists).
 */
export type QsbVaultState = "allocated" | "exposed" | "retired" | "unknown";

/** The deposit output a vault script was funded by; `txid` in display order. */
export type QsbFunding = {
  readonly txid: string;
  readonly valueSat: number;
  readonly vout: number;
};

/**
 * The one authorized disclosure of a key set: ordered round indices (never
 * sorted), the binding transaction `T` as hex, and its digest `D`.
 */
export type QsbDisclosure = {
  readonly digest: string;
  readonly round0: readonly number[];
  readonly round1: readonly number[];
  readonly transaction: string;
};

/**
 * One journal entry, mirroring the BIP manifest vault record. `root` is the
 * full 32-byte commitment root; `scriptHash` is SHA-256 of `scriptPubKey` and
 * is null exactly when the script is.
 */
export type QsbVaultRecord = {
  readonly disclosure: QsbDisclosure | null;
  readonly funding: QsbFunding | null;
  readonly root: string;
  readonly scriptHash: string | null;
  readonly scriptPubKey: string | null;
  readonly state: QsbVaultState;
  readonly v: number;
};

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
 * One QSB account: its dedicated phrase, provenance, and journal. `nextV` is
 * the allocation high-water mark; every index below it is reserved for good,
 * whether or not a record for it is still kept.
 */
export type QsbAccountRecord = {
  readonly backupConfirmed: boolean;
  readonly id: string;
  readonly mnemonic: string;
  readonly network: typeof QSB_NETWORK;
  readonly nextV: number;
  readonly seedContext: QsbSeedContext;
  readonly vaults: readonly QsbVaultRecord[];
};

const QSB_ACCOUNT_ID_PATTERN = /^qsb-[1-9][0-9]{0,3}$/;
const PHRASE_WORD_PATTERN = /^[a-z]+$/;

/**
 * Checks a QSB account id: `qsb-<n>`, n in 1..9999, allocated in sequence by
 * the vault. It carries no `:`, so it can never parse as a Starknet
 * `networkId:felt` account id, nor as an imported-phrase handle.
 */
export const isQsbAccountId = (value: unknown): value is string =>
  typeof value === "string" && QSB_ACCOUNT_ID_PATTERN.test(value);

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

const isHash32 = (value: unknown): value is string => isLowercaseHexBytes(value, 32, 32);

const isIndexBelow = (value: unknown, limit: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < limit;

/** Checks a high-water mark `nextV`: a safe integer in `[0, 2^31]`. */
export const isQsbHighWaterMark = (value: unknown): value is number =>
  isIndexBelow(value, QSB_VAULT_INDEX_LIMIT + 1);

const isVaultState = (value: unknown): value is QsbVaultState =>
  value === "allocated" || value === "exposed" || value === "retired" || value === "unknown";

const isScriptPubKey = (value: unknown): value is string =>
  isLowercaseHexBytes(value, 1, QSB_MAX_SCRIPT_BYTES);

const isFunding = (value: unknown): value is QsbFunding =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["txid", "valueSat", "vout"]) &&
  isHash32(value["txid"]) &&
  isIndexBelow(value["vout"], 2 ** 32) &&
  isIndexBelow(value["valueSat"], QSB_MAX_VALUE_SAT + 1);

const isRoundIndices = (value: unknown, count: number): value is readonly number[] =>
  Array.isArray(value) &&
  value.length === count &&
  value.every((index) => isIndexBelow(index, QSB_SECRETS_PER_ROUND)) &&
  new Set(value).size === count;

const isDisclosure = (value: unknown): value is QsbDisclosure =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["digest", "round0", "round1", "transaction"]) &&
  isRoundIndices(value["round0"], QSB_DISCLOSURE_COUNTS.round0) &&
  isRoundIndices(value["round1"], QSB_DISCLOSURE_COUNTS.round1) &&
  isLowercaseHexBytes(value["transaction"], 1, QSB_MAX_TRANSACTION_BYTES) &&
  isHash32(value["digest"]);

const VAULT_RECORD_KEYS = [
  "disclosure",
  "funding",
  "root",
  "scriptHash",
  "scriptPubKey",
  "state",
  "v",
] as const;

const hasVaultFields = (value: Record<string, unknown>): boolean =>
  hasOnlyKnownKeys(value, VAULT_RECORD_KEYS) &&
  isIndexBelow(value["v"], QSB_VAULT_INDEX_LIMIT) &&
  isHash32(value["root"]) &&
  (value["scriptPubKey"] === null || isScriptPubKey(value["scriptPubKey"])) &&
  (value["scriptHash"] === null || isHash32(value["scriptHash"])) &&
  (value["funding"] === null || isFunding(value["funding"])) &&
  isVaultState(value["state"]) &&
  (value["disclosure"] === null || isDisclosure(value["disclosure"]));

// The BIP manifest's cross-field rules: a script and its hash travel together,
// funding needs a script, a disclosure needs both, `exposed` needs all three,
// `allocated` has no disclosure, and a disclosure's T spends the funding
// exactly once. `retired` and `unknown` keep whatever their history holds.
const hasConsistentVaultFields = (record: QsbVaultRecord): boolean =>
  (record.scriptPubKey === null) === (record.scriptHash === null) &&
  (record.funding === null || record.scriptPubKey !== null) &&
  (record.state !== "exposed" || record.disclosure !== null) &&
  (record.state !== "allocated" || record.disclosure === null) &&
  (record.disclosure === null ||
    (record.funding !== null && spendsOutpointOnce(record.disclosure.transaction, record.funding)));

/**
 * Validates one vault record exactly as the BIP manifest specifies it: field
 * grammars and ranges, ordered distinct disclosure indices, and every
 * cross-field rule. Its position in the journal is checked by the account.
 */
export const isQsbVaultRecord = (value: unknown): value is QsbVaultRecord =>
  isRecord(value) &&
  hasVaultFields(value) &&
  hasConsistentVaultFields(value as unknown as QsbVaultRecord);

/**
 * Checks a journal's ordering against its high-water mark: strictly ascending
 * (so sorted and unique) indices, every one below `nextV`, within the bound.
 */
export const isQsbJournalOrder = (vaults: readonly QsbVaultRecord[], nextV: number): boolean =>
  vaults.length <= MAX_QSB_VAULTS_PER_ACCOUNT &&
  vaults.every((vault, index) => index === 0 || (vaults[index - 1]?.v ?? -1) < vault.v) &&
  (vaults.at(-1)?.v ?? -1) < nextV;

const isSeedContext = (value: unknown): value is QsbSeedContext =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["provenance", "source"]) &&
  (value["provenance"] === "generated-here" || value["provenance"] === "imported") &&
  value["source"] === "bip39";

const ACCOUNT_KEYS = [
  "backupConfirmed",
  "id",
  "mnemonic",
  "network",
  "nextV",
  "seedContext",
  "vaults",
] as const;

const hasAccountFields = (value: Record<string, unknown>): boolean =>
  hasOnlyKnownKeys(value, ACCOUNT_KEYS) &&
  isQsbAccountId(value["id"]) &&
  isQsbMnemonic(value["mnemonic"]) &&
  isSeedContext(value["seedContext"]) &&
  typeof value["backupConfirmed"] === "boolean" &&
  value["network"] === QSB_NETWORK &&
  isQsbHighWaterMark(value["nextV"]) &&
  Array.isArray(value["vaults"]) &&
  value["vaults"].every(isQsbVaultRecord);

// Bramble's writer rule, made a stored invariant: an imported journal never
// holds a key set it could still disclose from, and nothing is allocated
// before the user has confirmed the phrase backup.
const hasProvenanceRules = (account: QsbAccountRecord): boolean =>
  account.seedContext.provenance === "imported"
    ? account.vaults.every((vault) => vault.state === "retired" || vault.state === "unknown")
    : account.backupConfirmed || (account.nextV === 0 && account.vaults.length === 0);

/**
 * Validates one QSB account: field grammars, a well-ordered journal under its
 * high-water mark, every vault record, and the provenance rules. Uniqueness
 * across accounts is checked by {@link hasValidQsbAccounts}.
 */
export const isQsbAccountRecord = (value: unknown): value is QsbAccountRecord => {
  if (!isRecord(value) || !hasAccountFields(value)) {
    return false;
  }
  const account = value as unknown as QsbAccountRecord;
  return isQsbJournalOrder(account.vaults, account.nextV) && hasProvenanceRules(account);
};

/**
 * True when this account may allocate a vault or disclose from one: its phrase
 * was generated in this vault (so no other copy can be writing) and the user
 * confirmed its backup. Every other account is read-only.
 */
export const isQsbWriter = (account: QsbAccountRecord): boolean =>
  account.seedContext.provenance === "generated-here" && account.backupConfirmed;

// Whitespace-insensitive, case-folded, NFKD word sequence, so a phrase stored
// with other spacing still collides with its QSB twin.
const phraseKey = (phrase: string): string =>
  phrase.normalize("NFKD").toLowerCase().trim().split(/\s+/).join(" ");

/**
 * Validates the vault's whole QSB collection: within the account bound, every
 * account valid, ids distinct, and every phrase dedicated — not held by a
 * second QSB account (two journals for one phrase would be two writers) and
 * not one of the vault's Starknet phrases (`otherPhrases`). Fails closed.
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
    hasUniqueStrings(phrases) &&
    phrases.every((phrase) => !others.has(phrase))
  );
};
