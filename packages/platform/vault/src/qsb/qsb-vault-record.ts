/**
 * One QSB vault record: the journal entry for one key set, mirroring the
 * vault record of the "QSB Wallet Secret Management" BIP manifest (profile
 * QSB-HORS-v1). A key set is one deposit and one withdrawal, locked by
 * 2 x 150 one-time HORS secrets; a withdrawal discloses 8 round-0 and 7
 * round-1 preimages, after which the key set is spent for good.
 *
 * Validators only, total and fail-closed: a malformed, unbounded, or
 * internally inconsistent record is invalid. Cryptographic facts (that a root
 * derives from the phrase, a script hashes to its hash, a digest binds its
 * transaction) are not checkable here and are re-established by the
 * background through Krusty.
 */
import { isLowercaseHexBytes } from "@bramble/core/hex";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { QSB_MAX_VAULTS_PER_ACCOUNT } from "@bramble/wallet-model/qsb-vaults";
import { spendsOutpointOnce } from "./qsb-transaction";

/** The derivation profile every QSB record follows. */
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

/**
 * Most vault records one QSB journal keeps. A further allocation or import is
 * refused, never evicting a record: a forgotten record is a key set that could
 * be mistaken for unused. The journal's byte cap (`QSB_JOURNAL_MAX_BYTES`)
 * applies too and refuses earlier once records carry full-size scripts.
 * Single-sourced with the UI from the shared contract.
 */
export const MAX_QSB_VAULTS_PER_ACCOUNT = QSB_MAX_VAULTS_PER_ACCOUNT;

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

/** Checks 32 bytes as 64 lowercase hex digits (roots, hashes, txids, ids). */
export const isQsbHash32 = (value: unknown): value is string => isLowercaseHexBytes(value, 32, 32);

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
  isQsbHash32(value["txid"]) &&
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
  isQsbHash32(value["digest"]);

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
  isQsbHash32(value["root"]) &&
  (value["scriptPubKey"] === null || isScriptPubKey(value["scriptPubKey"])) &&
  (value["scriptHash"] === null || isQsbHash32(value["scriptHash"])) &&
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
 * cross-field rule. Its position in the journal is checked by the journal.
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
