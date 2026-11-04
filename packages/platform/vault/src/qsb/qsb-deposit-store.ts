/**
 * A QSB account's pending deposits: the signed deposit transactions kept
 * here before they are sent, so an unknown outcome can only ever resend the
 * same bytes (qsb-app `sdk/client.ts`, "Persist `{ txid, amount, rawTxHex }`
 * for the vault before the POST").
 *
 * One record per account in its own authenticated-encrypted key,
 * `bramble:qsb-deposit:<journalId>`, beside the account's journal and wired
 * exactly like it (same store factory, commit records, session shadow and
 * local mirror), under the same vault passphrase. The record is bound to its
 * account and journal id like the journal, and validated on every read and
 * write. It holds public chain data only — a signed transaction carries no
 * secret — but it says which Bitcoin a wallet holds, so it stays out of
 * messages, logs and session storage like the journal.
 *
 * Failure policy: a key that holds nothing is an empty record (it is created
 * by the first deposit, never at account creation). A record that cannot be
 * read, does not validate or names another account is unavailable, and the
 * caller refuses every deposit for that account: without it, Bramble cannot
 * know whether a signed deposit is still waiting.
 */

import { isLowercaseHexBytes } from "@bramble/core/hex";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { QSB_DEPOSIT_KEY_PREFIX } from "@bramble/store/kv";
import { QSB_MAX_SAT } from "@bramble/wallet-model/qsb-vaults";
import type { EncryptedStore } from "../encrypted-store";
import { isQsbAccountId, isQsbJournalId, type QsbAccountRecord } from "./qsb-account";
import { isQsbHash32, QSB_VAULT_INDEX_LIMIT } from "./qsb-vault-record";

/** The pending-deposit record's own schema version. */
export const QSB_DEPOSIT_SCHEMA_VERSION = 1;

/**
 * Most deposits one account keeps pending at once. A deposit is pending only
 * from its signing until the coordinator answers for it, so more than a few
 * means unknown outcomes are piling up; a further one is refused rather than
 * evicting a record, which could be the only copy of bytes in flight.
 */
export const QSB_MAX_PENDING_DEPOSITS = 4;

/**
 * Longest signed deposit kept, in bytes: Bramble's largest (eight P2WPKH
 * inputs, a 10,000-byte vault script, change) is 11,246 bytes.
 */
export const QSB_MAX_DEPOSIT_TX_BYTES = 12_000;

/**
 * Largest record, as exact plaintext bytes: four full-size deposits (24,000
 * hex digits and about 110 bytes of fields each) and the header fit in 96.6
 * KB. Its encrypted envelope stays inside the provider budget every
 * non-vault key is held to.
 */
export const QSB_DEPOSIT_STORE_MAX_BYTES = 100 * 1024;

/** One signed deposit into vault `v`, kept until the coordinator answers for it. */
export type QsbPendingDeposit = {
  readonly amountSat: number;
  readonly rawTxHex: string;
  readonly txid: string;
  readonly v: number;
};

/** One account's record: its binding and its pending deposits, ascending by `v`. */
export type QsbPendingDeposits = {
  readonly accountId: string;
  readonly deposits: readonly QsbPendingDeposit[];
  readonly journalId: string;
  readonly schemaVersion: typeof QSB_DEPOSIT_SCHEMA_VERSION;
};

/** What reading an account's record produced. */
export type QsbPendingRead =
  | { readonly deposits: readonly QsbPendingDeposit[]; readonly status: "bound" }
  | { readonly status: "unavailable" };

/**
 * The storage key of one account's pending deposits, or null for anything
 * that is not a journal id.
 */
export const qsbDepositStorageKey = (journalId: string): string | null =>
  isQsbJournalId(journalId) ? `${QSB_DEPOSIT_KEY_PREFIX}${journalId}` : null;

const isAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= QSB_MAX_SAT;

const isPendingDeposit = (value: unknown): value is QsbPendingDeposit =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["amountSat", "rawTxHex", "txid", "v"]) &&
  isAmount(value["amountSat"]) &&
  isLowercaseHexBytes(value["rawTxHex"], 1, QSB_MAX_DEPOSIT_TX_BYTES) &&
  isQsbHash32(value["txid"]) &&
  typeof value["v"] === "number" &&
  Number.isSafeInteger(value["v"]) &&
  value["v"] >= 0 &&
  value["v"] < QSB_VAULT_INDEX_LIMIT;

const isAscending = (deposits: readonly QsbPendingDeposit[]): boolean =>
  deposits.every((deposit, index) => index === 0 || (deposits[index - 1]?.v ?? -1) < deposit.v);

/** Exact serialized size of a record: every field is ASCII. */
const recordBytes = (record: QsbPendingDeposits): number => JSON.stringify(record).length;

/**
 * Validates a record for `account`: the header names this account and
 * journal, at most {@link QSB_MAX_PENDING_DEPOSITS} deposits strictly
 * ascending by vault, each in its grammar, within the byte cap.
 */
export const isQsbPendingDeposits = (
  value: unknown,
  account: Pick<QsbAccountRecord, "id" | "journalId">,
): value is QsbPendingDeposits => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["accountId", "deposits", "journalId", "schemaVersion"]) ||
    value["schemaVersion"] !== QSB_DEPOSIT_SCHEMA_VERSION ||
    !isQsbAccountId(value["accountId"]) ||
    value["accountId"] !== account.id ||
    value["journalId"] !== account.journalId ||
    !Array.isArray(value["deposits"]) ||
    value["deposits"].length > QSB_MAX_PENDING_DEPOSITS ||
    !value["deposits"].every(isPendingDeposit)
  ) {
    return false;
  }
  const record = value as unknown as QsbPendingDeposits;
  return isAscending(record.deposits) && recordBytes(record) <= QSB_DEPOSIT_STORE_MAX_BYTES;
};

/**
 * Reads and validates one account's record. Never throws: a key that holds
 * nothing is bound and empty; everything else that is not a valid record for
 * this account is unavailable.
 */
export const readQsbPendingDeposits = async (
  store: Pick<EncryptedStore, "read">,
  account: Pick<QsbAccountRecord, "id" | "journalId">,
  vaultPassphrase: string,
): Promise<QsbPendingRead> => {
  try {
    const value = await store.read(vaultPassphrase);
    if (value === undefined) return { deposits: [], status: "bound" };
    return isQsbPendingDeposits(value, account)
      ? { deposits: value.deposits, status: "bound" }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
};

/**
 * The record holding `deposits` for `account`, sorted by vault, or null when
 * it would not be valid (too many, a repeated vault, a malformed deposit, too
 * large), so nothing invalid is ever written.
 */
export const qsbPendingRecord = (
  account: Pick<QsbAccountRecord, "id" | "journalId">,
  deposits: readonly QsbPendingDeposit[],
): QsbPendingDeposits | null => {
  const record: QsbPendingDeposits = {
    accountId: account.id,
    deposits: [...deposits].sort((left, right) => left.v - right.v),
    journalId: account.journalId,
    schemaVersion: QSB_DEPOSIT_SCHEMA_VERSION,
  };
  return isQsbPendingDeposits(record, account) ? record : null;
};
