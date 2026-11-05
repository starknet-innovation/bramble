/**
 * A QSB account's withdrawals: for each deposit withdrawn, the intent fixed
 * before the coordinator's search starts, the signed transaction kept before
 * it is sent, and the last outcome the coordinator reported.
 *
 * Order (qsb-app `sdk/client.ts`, its intent and assembly guards): the intent
 * — the canonical manifest JSON and its hash, the frozen helper output, the
 * destination, fee and payout, and the job id — is durable before
 * `POST /v1/jobs`, so a lost answer can only ever be retried with the same
 * manifest; the signed bytes are durable before `POST …/submit`, so an
 * unknown outcome can only ever resend the same transaction. A withdrawal is
 * never re-intended on other terms: an intent, once kept, is never replaced,
 * and signed bytes, once kept, never change. Disclosure itself is the
 * journal's (`recordQsbExposure`), not this record's.
 *
 * One record per account in its own authenticated-encrypted key,
 * `bramble:qsb-withdrawal:<journalId>`, beside the account's journal and
 * pending deposits and wired exactly like them, under the same vault
 * passphrase, bound to the account and journal id and validated on every
 * read and write. Public chain data and public coordinator ids only: no key,
 * no preimage. It says which Bitcoin a wallet holds, so it stays out of
 * messages, logs and session storage like the journal.
 *
 * Failure policy: a key that holds nothing is an empty record. A record that
 * cannot be read, does not validate or names another account is
 * unavailable, and the caller refuses every withdrawal for that account and
 * every deposit that would pick coins (a helper output it cannot see could be
 * spent). A full record refuses a new intent rather than evict one.
 */
import { isLowercaseHexBytes } from "@bramble/core/hex";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { QSB_WITHDRAWAL_KEY_PREFIX } from "@bramble/store/kv";
import { QSB_MAX_SAT } from "@bramble/wallet-model/qsb-vaults";
import type { EncryptedStore } from "../encrypted-store";
import { isQsbAccountId, isQsbJournalId, type QsbAccountRecord } from "./qsb-account";
import { isQsbHash32, QSB_VAULT_INDEX_LIMIT } from "./qsb-vault-record";

/** The withdrawal record's own schema version. */
export const QSB_WITHDRAWAL_SCHEMA_VERSION = 1;

/**
 * Most withdrawals one account keeps. A vault is withdrawn once, ever, and the
 * journal's byte cap admits about twelve vaults with Bramble's 9,923-byte
 * scripts, so this is never the binding limit; a further intent is refused,
 * never evicting one.
 */
export const QSB_MAX_WITHDRAWALS = 16;

/**
 * Longest signed withdrawal kept, in bytes: two inputs (the QSB scriptSig at
 * most 1,185 bytes), one output and the helper's witness come to at most
 * about 1,440 bytes.
 */
export const QSB_MAX_WITHDRAWAL_TX_BYTES = 2_000;

/** Longest canonical manifest kept: its schema's bounds come to under 900 characters. */
export const QSB_MAX_MANIFEST_JSON = 1_200;

/**
 * Largest record, as exact plaintext bytes: sixteen full withdrawals (about
 * 5.5 KB each: the manifest, the signed bytes as 4,000 hex digits, and the
 * fields) and the header fit in 90 KB. Its encrypted envelope stays inside the
 * provider budget every non-vault key is held to.
 */
export const QSB_WITHDRAWAL_STORE_MAX_BYTES = 96 * 1024;

/**
 * What the coordinator last said about a withdrawal: `refused` (it refused
 * the job for good), `pending` (signed here, no answer yet), or a submit or
 * status answer.
 */
export type QsbWithdrawalOutcome =
  | "conflict"
  | "confirmed"
  | "pending"
  | "refused"
  | "submitted"
  | "uncertain";

/** The helper output a withdrawal spends beside the deposit, frozen at its intent. */
export type QsbWithdrawalHelper = {
  readonly txid: string;
  readonly valueSat: number;
  readonly vout: number;
};

/** A withdrawal's signed transaction, kept before it is sent. */
export type QsbSignedWithdrawalRecord = {
  readonly rawTxHex: string;
  readonly txid: string;
};

/** One deposit's withdrawal, as kept here. */
export type QsbWithdrawalRecord = {
  readonly destination: string;
  readonly feeSat: number;
  readonly helper: QsbWithdrawalHelper;
  /** Whether the coordinator answered the job's creation with this very job. */
  readonly jobCreated: boolean;
  readonly jobId: string;
  readonly manifestHash: string;
  readonly manifestJson: string;
  readonly outcome: QsbWithdrawalOutcome | null;
  readonly outputSat: number;
  readonly signed: QsbSignedWithdrawalRecord | null;
  readonly v: number;
};

/** One account's record: its binding and its withdrawals, ascending by `v`. */
export type QsbWithdrawals = {
  readonly accountId: string;
  readonly journalId: string;
  readonly schemaVersion: typeof QSB_WITHDRAWAL_SCHEMA_VERSION;
  readonly withdrawals: readonly QsbWithdrawalRecord[];
};

/** What reading an account's record produced. */
export type QsbWithdrawalsRead =
  | { readonly status: "bound"; readonly withdrawals: readonly QsbWithdrawalRecord[] }
  | { readonly status: "unavailable" };

const OUTCOMES: readonly QsbWithdrawalOutcome[] = [
  "conflict",
  "confirmed",
  "pending",
  "refused",
  "submitted",
  "uncertain",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECORD_KEYS = [
  "destination",
  "feeSat",
  "helper",
  "jobCreated",
  "jobId",
  "manifestHash",
  "manifestJson",
  "outcome",
  "outputSat",
  "signed",
  "v",
] as const;

/**
 * The storage key of one account's withdrawals, or null for anything that is
 * not a journal id.
 */
export const qsbWithdrawalStorageKey = (journalId: string): string | null =>
  isQsbJournalId(journalId) ? `${QSB_WITHDRAWAL_KEY_PREFIX}${journalId}` : null;

const isAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= QSB_MAX_SAT;

const isIndexBelow = (value: unknown, limit: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < limit;

const isHelper = (value: unknown): value is QsbWithdrawalHelper =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["txid", "valueSat", "vout"]) &&
  isQsbHash32(value["txid"]) &&
  isAmount(value["valueSat"]) &&
  isIndexBelow(value["vout"], 2 ** 32);

const isSigned = (value: unknown): value is QsbSignedWithdrawalRecord =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["rawTxHex", "txid"]) &&
  isLowercaseHexBytes(value["rawTxHex"], 1, QSB_MAX_WITHDRAWAL_TX_BYTES) &&
  isQsbHash32(value["txid"]);

const isManifestJson = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= QSB_MAX_MANIFEST_JSON &&
  isRecord(parseJson(value));

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// Signed bytes always carry an outcome; an outcome other than `refused`
// always follows signed bytes, and `refused` never does.
const isConsistent = (record: QsbWithdrawalRecord): boolean =>
  record.signed === null
    ? record.outcome === null || record.outcome === "refused"
    : record.outcome !== null && record.outcome !== "refused";

const isWithdrawal = (value: unknown): value is QsbWithdrawalRecord =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, RECORD_KEYS) &&
  typeof value["destination"] === "string" &&
  value["destination"].length >= 14 &&
  value["destination"].length <= 100 &&
  isAmount(value["feeSat"]) &&
  isAmount(value["outputSat"]) &&
  isHelper(value["helper"]) &&
  typeof value["jobCreated"] === "boolean" &&
  typeof value["jobId"] === "string" &&
  UUID.test(value["jobId"]) &&
  isQsbHash32(value["manifestHash"]) &&
  isManifestJson(value["manifestJson"]) &&
  (value["outcome"] === null || OUTCOMES.includes(value["outcome"] as QsbWithdrawalOutcome)) &&
  (value["signed"] === null || isSigned(value["signed"])) &&
  isIndexBelow(value["v"], QSB_VAULT_INDEX_LIMIT) &&
  isConsistent(value as unknown as QsbWithdrawalRecord);

// Strictly ascending by vault, and no helper output shared by two withdrawals.
const isWellOrdered = (withdrawals: readonly QsbWithdrawalRecord[]): boolean =>
  withdrawals.every((entry, index) => index === 0 || (withdrawals[index - 1]?.v ?? -1) < entry.v) &&
  new Set(withdrawals.map(({ helper }) => `${helper.txid}:${helper.vout}`)).size ===
    withdrawals.length &&
  new Set(withdrawals.map(({ jobId }) => jobId)).size === withdrawals.length;

/** Exact serialized size of a record: every field is ASCII. */
const recordBytes = (record: QsbWithdrawals): number => JSON.stringify(record).length;

/**
 * Validates a record for `account`: the header names this account and
 * journal, at most {@link QSB_MAX_WITHDRAWALS} withdrawals strictly ascending
 * by vault with distinct helpers and job ids, each in its grammar, within the
 * byte cap.
 */
export const isQsbWithdrawals = (
  value: unknown,
  account: Pick<QsbAccountRecord, "id" | "journalId">,
): value is QsbWithdrawals => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["accountId", "journalId", "schemaVersion", "withdrawals"]) ||
    value["schemaVersion"] !== QSB_WITHDRAWAL_SCHEMA_VERSION ||
    !isQsbAccountId(value["accountId"]) ||
    value["accountId"] !== account.id ||
    value["journalId"] !== account.journalId ||
    !Array.isArray(value["withdrawals"]) ||
    value["withdrawals"].length > QSB_MAX_WITHDRAWALS ||
    !value["withdrawals"].every(isWithdrawal)
  ) {
    return false;
  }
  const record = value as unknown as QsbWithdrawals;
  return isWellOrdered(record.withdrawals) && recordBytes(record) <= QSB_WITHDRAWAL_STORE_MAX_BYTES;
};

/**
 * Reads and validates one account's record. Never throws: a key that holds
 * nothing is bound and empty; everything else that is not a valid record for
 * this account is unavailable.
 */
export const readQsbWithdrawals = async (
  store: Pick<EncryptedStore, "read">,
  account: Pick<QsbAccountRecord, "id" | "journalId">,
  vaultPassphrase: string,
): Promise<QsbWithdrawalsRead> => {
  try {
    const value = await store.read(vaultPassphrase);
    if (value === undefined) return { status: "bound", withdrawals: [] };
    return isQsbWithdrawals(value, account)
      ? { status: "bound", withdrawals: value.withdrawals }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
};

/**
 * The record holding `withdrawals` for `account`, sorted by vault, or null
 * when it would not be valid (too many, a repeated vault or helper, a
 * malformed field, too large), so nothing invalid is ever written.
 */
export const qsbWithdrawalsRecord = (
  account: Pick<QsbAccountRecord, "id" | "journalId">,
  withdrawals: readonly QsbWithdrawalRecord[],
): QsbWithdrawals | null => {
  const record: QsbWithdrawals = {
    accountId: account.id,
    journalId: account.journalId,
    schemaVersion: QSB_WITHDRAWAL_SCHEMA_VERSION,
    withdrawals: [...withdrawals].sort((left, right) => left.v - right.v),
  };
  return isQsbWithdrawals(record, account) ? record : null;
};
