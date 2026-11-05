/**
 * Strict runtime client for Quantum Safe Bitcoin (QSB) vaults and deposits:
 * the five extension-page messages of `@bramble/wallet-model/qsb-vaults`, each
 * reply validated here before anything renders it. Every reply is untrusted:
 * a shape this module does not recognise is refused, never partly read.
 *
 * Nothing here carries key material: requests name an account id, a vault
 * index and satoshi amounts; replies carry an owner address, public chain data
 * and quotes.
 *
 * Failure behaviour: a refusal rejects with the background's diagnostic, which
 * the shared copy table translates. An unrecognised reply to a read rejects
 * with "wallet unavailable"; to a write (create, deposit, resend), with "wallet
 * request failed", whose copy says the outcome is unknown, because the write
 * may have run. A lost reply to a write becomes `SubmissionUnknownError` in the
 * panel's send wrapper (see runtime-errors.ts).
 */
import { hasOnlyKnownKeys, isDecimalAmountText, isRecord } from "@bramble/core/json";
import {
  QSB_MAX_SAT,
  QSB_MAX_VAULTS_PER_ACCOUNT,
  type QsbDepositQuote,
  type QsbDepositStatus,
  type QsbOwnerFunds,
  type QsbSubmission,
  type QsbVaultView,
} from "@bramble/wallet-model/qsb-vaults";
import type { QsbWithdrawalStatus, QsbWithdrawalView } from "@bramble/wallet-model/qsb-withdrawals";
import { responseError } from "../../runtime/runtime-errors";

// Mainnet bech32 P2WPKH: `bc1q`, then 32 data and 6 checksum characters from
// the bech32 alphabet (no 1, b, i or o), lowercase only. 42 characters in all.
const OWNER_ADDRESS = /^bc1q[02-9ac-hj-np-z]{38}$/;
// A transaction id in display order: 32 bytes as lowercase hex.
const TXID = /^[0-9a-f]{64}$/;
// sat/vB as decimal text ("2", "2.5"): the shared decimal grammar, bounded so
// a reply cannot choose how long a line the review prints.
const MAX_FEE_RATE_LENGTH = 16;

const DEPOSIT_STATUSES: readonly QsbDepositStatus[] = ["confirmed", "none", "pending", "submitted"];
const VAULT_STATES: readonly QsbVaultView["state"][] = [
  "allocated",
  "exposed",
  "retired",
  "unknown",
];
/**
 * The deposit status a submission outcome leaves its vault in, per the
 * contract: MARA has a `submitted` deposit (and may already have mined it), an
 * `uncertain` one is still kept here as `pending`, and a `rejected` vault takes
 * a new deposit. A reply pairing an outcome with any other status is refused.
 */
const SUBMISSION_STATUSES: Readonly<Record<QsbSubmission, readonly QsbDepositStatus[]>> = {
  rejected: ["none"],
  submitted: ["confirmed", "submitted"],
  uncertain: ["pending"],
};

/** Whether `value` is a satoshi amount: an integer in `[0, QSB_MAX_SAT]`. */
const isQsbSat = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= QSB_MAX_SAT;

/** Whether `value` is a vault index: a safe non-negative integer. */
export const isQsbVaultIndex = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Whether `value` is a mainnet bech32 P2WPKH address (`bc1q…`, 42 characters). */
export const isQsbOwnerAddress = (value: unknown): value is string =>
  typeof value === "string" && OWNER_ADDRESS.test(value);

/** Whether `value` is a transaction id: 64 lowercase hex characters. */
export const isQsbTxid = (value: unknown): value is string =>
  typeof value === "string" && TXID.test(value);

const isCount = isQsbVaultIndex;
const isPositiveCount = (value: unknown): value is number => isCount(value) && value > 0;

const isDeposit = (value: unknown): value is QsbVaultView["deposit"] =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["amountSat", "confirmations", "status", "txid"]) &&
  (value["amountSat"] === null || isQsbSat(value["amountSat"])) &&
  (value["confirmations"] === null || isCount(value["confirmations"])) &&
  DEPOSIT_STATUSES.some((status) => status === value["status"]) &&
  (value["txid"] === null || isQsbTxid(value["txid"]));

// A mainnet destination as text: bech32 `bc1…` or base58 `1…`/`3…`. The
// background decides which types it accepts; this only bounds what is shown.
const DESTINATION = /^(?:bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/;
const isQsbDestinationText = (value: unknown): value is string =>
  typeof value === "string" && DESTINATION.test(value);

const WITHDRAWAL_STATUSES: readonly QsbWithdrawalStatus[] = [
  "conflict",
  "confirmed",
  "failed",
  "none",
  "paused",
  "pending",
  "ready",
  "searching",
  "submitted",
  "uncertain",
];

// A withdrawal: its six keys, the status enum, and every other field null
// while nothing has started.
const isWithdrawal = (value: unknown): value is QsbWithdrawalView => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, [
      "confirmations",
      "destination",
      "feeSat",
      "outputSat",
      "status",
      "txid",
    ]) ||
    !WITHDRAWAL_STATUSES.some((status) => status === value["status"]) ||
    !(value["confirmations"] === null || isCount(value["confirmations"])) ||
    !(value["destination"] === null || isQsbDestinationText(value["destination"])) ||
    !(value["feeSat"] === null || isQsbSat(value["feeSat"])) ||
    !(value["outputSat"] === null || isQsbSat(value["outputSat"])) ||
    !(value["txid"] === null || isQsbTxid(value["txid"]))
  ) {
    return false;
  }
  return (
    value["status"] !== "none" ||
    ["confirmations", "destination", "feeSat", "outputSat", "txid"].every(
      (key) => value[key] === null,
    )
  );
};

/**
 * Whether `value` is exactly one {@link QsbVaultView}: its five keys, the
 * enums, a safe non-negative index, satoshi amounts in range, and a txid that
 * is 64 lowercase hex characters or null. Anything else is refused.
 */
export const isQsbVaultView = (value: unknown): value is QsbVaultView =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["deposit", "registered", "state", "v", "withdrawal"]) &&
  isDeposit(value["deposit"]) &&
  isWithdrawal(value["withdrawal"]) &&
  (value["registered"] === null || typeof value["registered"] === "boolean") &&
  VAULT_STATES.some((state) => state === value["state"]) &&
  isQsbVaultIndex(value["v"]);

// No unspent output means no funds; the converse need not hold, since an
// output may carry nothing.
const isOwnerFunds = (value: unknown): value is QsbOwnerFunds =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["totalSat", "utxoCount"]) &&
  isQsbSat(value["totalSat"]) &&
  isCount(value["utxoCount"]) &&
  (value["utxoCount"] > 0 || value["totalSat"] === 0);

/**
 * One account's vaults as `wallet.qsbVaults` reports them: its owner address,
 * its confirmed funds (null when the coordinator cannot be reached) and every
 * vault, in ascending index order.
 */
export type QsbVaultsReading = {
  readonly address: string;
  readonly funds: QsbOwnerFunds | null;
  readonly vaults: readonly QsbVaultView[];
};

/**
 * The `wallet.qsbVaults` reply, read whole or not at all: a valid address,
 * funds or null, and at most `QSB_MAX_VAULTS_PER_ACCOUNT` valid vaults with
 * distinct indices. The vaults come back sorted by index, so the order shown
 * never depends on the reply's.
 */
export const readQsbVaults = (value: unknown): QsbVaultsReading | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["address", "funds", "ok", "vaults"]) ||
    value["ok"] !== true ||
    !isQsbOwnerAddress(value["address"]) ||
    !(value["funds"] === null || isOwnerFunds(value["funds"]))
  ) {
    return null;
  }
  const vaults = value["vaults"];
  if (
    !Array.isArray(vaults) ||
    vaults.length > QSB_MAX_VAULTS_PER_ACCOUNT ||
    !vaults.every(isQsbVaultView) ||
    new Set(vaults.map((vault) => vault.v)).size !== vaults.length
  ) {
    return null;
  }
  return {
    address: value["address"],
    funds: value["funds"],
    vaults: [...vaults].sort((a, b) => a.v - b.v),
  };
};

/**
 * Whether `value` is exactly one {@link QsbDepositQuote}: satoshi fields in
 * range whose amount, change and fee together still fit in `QSB_MAX_SAT`, a
 * decimal fee rate, and at least one input and one virtual byte.
 */
export const isQsbDepositQuote = (value: unknown): value is QsbDepositQuote =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "amountSat",
    "changeSat",
    "feeRate",
    "feeSat",
    "inputCount",
    "vsize",
    "withdrawalFeeSat",
  ]) &&
  isQsbSat(value["amountSat"]) &&
  isQsbSat(value["changeSat"]) &&
  isQsbSat(value["feeSat"]) &&
  isQsbSat(value["withdrawalFeeSat"]) &&
  value["amountSat"] + value["changeSat"] + value["feeSat"] <= QSB_MAX_SAT &&
  typeof value["feeRate"] === "string" &&
  value["feeRate"].length <= MAX_FEE_RATE_LENGTH &&
  isDecimalAmountText(value["feeRate"]) &&
  isPositiveCount(value["inputCount"]) &&
  isPositiveCount(value["vsize"]);

/** How a submitted or resent deposit went, and the vault as it now stands. */
export type QsbDepositResult = {
  readonly submission: QsbSubmission;
  readonly vault: QsbVaultView;
};

const isSubmission = (value: unknown): value is QsbSubmission =>
  value === "rejected" || value === "submitted" || value === "uncertain";

/**
 * The reply to a deposit or a resend into vault `v`: that same vault, still
 * allocated, in the deposit status its outcome implies; or null.
 */
const readDepositResult = (value: unknown, v: number): QsbDepositResult | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["ok", "submission", "vault"]) ||
    value["ok"] !== true ||
    !isSubmission(value["submission"]) ||
    !isQsbVaultView(value["vault"])
  ) {
    return null;
  }
  const { submission, vault } = { submission: value["submission"], vault: value["vault"] };
  return vault.v === v &&
    vault.state === "allocated" &&
    SUBMISSION_STATUSES[submission].includes(vault.deposit.status)
    ? { submission, vault }
    : null;
};

/**
 * Creates the QSB vault client over the panel's privileged channel. Each
 * method rejects rather than return a half-read reply.
 */
export const createQsbVaultClient = (sendMessage: (message: unknown) => Promise<unknown>) => ({
  /** Reads one account's owner address, funds and vaults. Read-only. */
  async loadQsbVaults(accountId: string): Promise<QsbVaultsReading> {
    const response = await sendMessage({ accountId, type: "wallet.qsbVaults" });
    const reading = readQsbVaults(response);
    if (reading) return reading;
    throw responseError(response, "wallet unavailable");
  },
  /**
   * Allocates and registers the account's next vault. The reply must be that
   * new vault: allocated, registered, with no deposit.
   */
  async createQsbVault(accountId: string): Promise<QsbVaultView> {
    const response = await sendMessage({ accountId, type: "wallet.createQsbVault" });
    const vault =
      isRecord(response) &&
      hasOnlyKnownKeys(response, ["ok", "vault"]) &&
      response["ok"] === true &&
      isQsbVaultView(response["vault"])
        ? response["vault"]
        : null;
    if (
      vault?.state === "allocated" &&
      vault.registered === true &&
      vault.deposit.status === "none"
    ) {
      return vault;
    }
    // Its copy says the outcome is unknown: the write may have run.
    throw responseError(response, "wallet request failed");
  },
  /**
   * Prices a deposit of `amountSat` into vault `v` now. Read-only. The quote
   * must be for exactly that amount.
   */
  async quoteQsbDeposit(accountId: string, v: number, amountSat: number): Promise<QsbDepositQuote> {
    const response = await sendMessage({ accountId, amountSat, type: "wallet.quoteQsbDeposit", v });
    const quote =
      isRecord(response) &&
      hasOnlyKnownKeys(response, ["ok", "quote"]) &&
      response["ok"] === true &&
      isQsbDepositQuote(response["quote"])
        ? response["quote"]
        : null;
    if (quote?.amountSat === amountSat) return quote;
    throw responseError(response, "wallet unavailable");
  },
  /**
   * Builds, signs and submits a deposit of `amountSat` into vault `v` at the
   * `feeSat` the user accepted. A deposit that would now cost anything else is
   * refused as `quoteChanged`.
   */
  async depositQsbVault(
    accountId: string,
    v: number,
    amountSat: number,
    feeSat: number,
  ): Promise<QsbDepositResult> {
    const response = await sendMessage({
      accountId,
      amountSat,
      feeSat,
      type: "wallet.depositQsbVault",
      v,
    });
    const result = readDepositResult(response, v);
    if (result) return result;
    // Its copy says the outcome is unknown: the write may have run.
    throw responseError(response, "wallet request failed");
  },
  /** Sends vault `v`'s pending deposit again: the same signed bytes, never new ones. */
  async resendQsbDeposit(accountId: string, v: number): Promise<QsbDepositResult> {
    const response = await sendMessage({ accountId, type: "wallet.resendQsbDeposit", v });
    const result = readDepositResult(response, v);
    if (result) return result;
    // Its copy says the outcome is unknown: the write may have run.
    throw responseError(response, "wallet request failed");
  },
});

/** The QSB vault methods the panel's wallet client carries. */
export type QsbVaultWallet = ReturnType<typeof createQsbVaultClient>;
