/**
 * Strict runtime client for QSB withdrawals: the five extension-page messages
 * of `@bramble/wallet-model/qsb-withdrawals`, each reply validated here before
 * anything renders it. Every reply is untrusted: a shape this module does not
 * recognise is refused, never partly read.
 *
 * Secret boundary: the release request carries the wallet passphrase the
 * user just typed, and nothing else here touches it; it is passed through to
 * the background and kept nowhere. No reply carries a released secret.
 *
 * Failure behaviour: a refusal rejects with the background's diagnostic. Once
 * the background has released anything it answers a submission rather than
 * refuse, so a refused release released nothing. An unrecognised reply to a
 * read rejects with "wallet unavailable"; to a write (start, release, resend),
 * with "wallet request failed", whose copy says the outcome is unknown. A
 * lost reply to a write becomes `SubmissionUnknownError` in the panel's send
 * wrapper (see runtime-errors.ts).
 */
import { hasOnlyKnownKeys, isDecimalAmountText, isRecord } from "@bramble/core/json";
import type { QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import {
  QSB_DISCLOSED_SECRETS,
  type QsbWithdrawalQuote,
  type QsbWithdrawalReview,
  type QsbWithdrawalStatus,
  type QsbWithdrawalSubmission,
} from "@bramble/wallet-model/qsb-withdrawals";
import { responseError } from "../../runtime/runtime-errors";
import { isQsbDestination, isQsbSat, isQsbVaultIndex, isQsbVaultView } from "./qsb-vault-runtime";

// sat/vB as decimal text, bounded as the deposit quote's is.
const MAX_FEE_RATE_LENGTH = 16;

const isFeeRate = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_FEE_RATE_LENGTH && isDecimalAmountText(value);

const isPositive = (value: unknown): value is number => isQsbVaultIndex(value) && value > 0;

// What the destination receives is the deposit plus the helper output, less
// the fee, exactly: the screens show that sum, so a reply breaking it is
// refused rather than shown.
const addsUp = (fundingSat: number, helperSat: number, feeSat: number, outputSat: number) =>
  feeSat < fundingSat + helperSat && outputSat === fundingSat + helperSat - feeSat;

/**
 * Whether `value` is exactly one {@link QsbWithdrawalQuote}: a destination
 * address, a decimal fee rate, satoshi amounts in range with a positive
 * helper output and size, and an output that is the deposit plus the helper
 * less the fee.
 */
export const isQsbWithdrawalQuote = (value: unknown): value is QsbWithdrawalQuote =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "destination",
    "feeRate",
    "feeSat",
    "fundingSat",
    "helperSat",
    "outputSat",
    "vsize",
  ]) &&
  isQsbDestination(value["destination"]) &&
  isFeeRate(value["feeRate"]) &&
  isQsbSat(value["feeSat"]) &&
  isQsbSat(value["fundingSat"]) &&
  isQsbSat(value["helperSat"]) &&
  value["helperSat"] > 0 &&
  isQsbSat(value["outputSat"]) &&
  isPositive(value["vsize"]) &&
  addsUp(value["fundingSat"], value["helperSat"], value["feeSat"], value["outputSat"]);

// 32 bytes as lowercase hex: the disclosure digest the release must echo.
const DIGEST = /^[0-9a-f]{64}$/;

/**
 * Whether `value` is exactly one {@link QsbWithdrawalReview}: an unverified
 * binding (the only kind the contract has), Bitcoin mainnet, exactly
 * `QSB_DISCLOSED_SECRETS` secrets, a 64-hex digest, a destination address,
 * satoshi amounts that add up as the quote's do, and a positive size.
 */
export const isQsbWithdrawalReview = (value: unknown): value is QsbWithdrawalReview =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "binding",
    "destination",
    "digest",
    "feeSat",
    "fundingSat",
    "helperSat",
    "network",
    "outputSat",
    "secrets",
    "v",
    "vsize",
  ]) &&
  value["binding"] === "unverified" &&
  value["network"] === "bitcoin-mainnet" &&
  value["secrets"] === QSB_DISCLOSED_SECRETS &&
  typeof value["digest"] === "string" &&
  DIGEST.test(value["digest"]) &&
  isQsbDestination(value["destination"]) &&
  isQsbVaultIndex(value["v"]) &&
  isQsbSat(value["feeSat"]) &&
  isQsbSat(value["fundingSat"]) &&
  isQsbSat(value["helperSat"]) &&
  value["helperSat"] > 0 &&
  isQsbSat(value["outputSat"]) &&
  isPositive(value["vsize"]) &&
  addsUp(value["fundingSat"], value["helperSat"], value["feeSat"], value["outputSat"]);

/** How a released or resent withdrawal went, and the deposit as it now stands. */
export type QsbWithdrawalResult = {
  readonly submission: QsbWithdrawalSubmission;
  readonly vault: QsbVaultView;
};

/**
 * The withdrawal status a submission outcome leaves its deposit in: MARA has
 * a `submitted` one (and may have mined it), a `confirmed` one is mined, an
 * `uncertain` one is still here (sent or not), and a `conflict` is final.
 */
const SUBMISSION_STATUSES: Readonly<
  Record<QsbWithdrawalSubmission, readonly QsbWithdrawalStatus[]>
> = {
  conflict: ["conflict"],
  confirmed: ["confirmed"],
  submitted: ["confirmed", "submitted"],
  uncertain: ["pending", "uncertain"],
};

const isSubmission = (value: unknown): value is QsbWithdrawalSubmission =>
  value === "conflict" || value === "confirmed" || value === "submitted" || value === "uncertain";

/**
 * The reply to a release or a resend of deposit `v`'s withdrawal: that same
 * deposit, its withdrawal in the status its outcome implies; or null.
 */
const readWithdrawalResult = (value: unknown, v: number): QsbWithdrawalResult | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["ok", "submission", "vault"]) ||
    value["ok"] !== true ||
    !isSubmission(value["submission"]) ||
    !isQsbVaultView(value["vault"])
  ) {
    return null;
  }
  const submission = value["submission"];
  const vault = value["vault"];
  return vault.v === v && SUBMISSION_STATUSES[submission].includes(vault.withdrawal.status)
    ? { submission, vault }
    : null;
};

/** The `{ ok: true, <key>: … }` payload of a reply when `accept` takes it, or null. */
const payload = <T>(
  value: unknown,
  key: string,
  accept: (candidate: unknown) => candidate is T,
): T | null => {
  if (!isRecord(value) || !hasOnlyKnownKeys(value, ["ok", key]) || value["ok"] !== true) {
    return null;
  }
  const candidate = value[key];
  return accept(candidate) ? candidate : null;
};

/**
 * Creates the QSB withdrawal client over the panel's privileged channel. Each
 * method rejects rather than return a half-read reply.
 */
export const createQsbWithdrawalClient = (sendMessage: (message: unknown) => Promise<unknown>) => ({
  /**
   * What withdrawing deposit `v` to `destination` would pay and cost now.
   * Read-only. The quote must be for exactly that destination.
   */
  async quoteQsbWithdrawal(
    accountId: string,
    v: number,
    destination: string,
  ): Promise<QsbWithdrawalQuote> {
    const response = await sendMessage({
      accountId,
      destination,
      type: "wallet.quoteQsbWithdrawal",
      v,
    });
    const quote = payload(response, "quote", isQsbWithdrawalQuote);
    if (quote?.destination === destination) return quote;
    throw responseError(response, "wallet unavailable");
  },
  /**
   * Fixes deposit `v`'s withdrawal at the `feeSat` the user accepted and
   * starts the QSB service's search. The reply must be that deposit,
   * searching, with that destination and fee.
   */
  async startQsbWithdrawal(
    accountId: string,
    v: number,
    destination: string,
    feeSat: number,
  ): Promise<QsbVaultView> {
    const response = await sendMessage({
      accountId,
      destination,
      feeSat,
      type: "wallet.startQsbWithdrawal",
      v,
    });
    const vault = payload(response, "vault", isQsbVaultView);
    const withdrawal = vault?.withdrawal;
    if (
      vault?.v === v &&
      withdrawal?.status === "searching" &&
      withdrawal.destination === destination &&
      withdrawal.feeSat === feeSat
    ) {
      return vault;
    }
    // Its copy says the outcome is unknown: the write may have run.
    throw responseError(response, "wallet request failed");
  },
  /** The release review of deposit `v`'s found withdrawal. Read-only; discloses nothing. */
  async reviewQsbWithdrawal(accountId: string, v: number): Promise<QsbWithdrawalReview> {
    const response = await sendMessage({ accountId, type: "wallet.reviewQsbWithdrawal", v });
    const review = payload(response, "review", isQsbWithdrawalReview);
    if (review?.v === v) return review;
    throw responseError(response, "wallet unavailable");
  },
  /**
   * Authorizes the release of exactly what `digest` names, against the
   * wallet passphrase the user just typed, and submits the withdrawal.
   */
  async releaseQsbWithdrawal(
    accountId: string,
    v: number,
    digest: string,
    passphrase: string,
  ): Promise<QsbWithdrawalResult> {
    const response = await sendMessage({
      accountId,
      digest,
      passphrase,
      type: "wallet.releaseQsbWithdrawal",
      v,
    });
    const result = readWithdrawalResult(response, v);
    if (result) return result;
    // Its copy says the outcome is unknown: the write may have run.
    throw responseError(response, "wallet request failed");
  },
  /** Sends deposit `v`'s signed withdrawal again: the same transaction, never a new one. */
  async resendQsbWithdrawal(accountId: string, v: number): Promise<QsbWithdrawalResult> {
    const response = await sendMessage({ accountId, type: "wallet.resendQsbWithdrawal", v });
    const result = readWithdrawalResult(response, v);
    if (result) return result;
    // Its copy says the outcome is unknown: the write may have run.
    throw responseError(response, "wallet request failed");
  },
});

/** The QSB withdrawal methods the panel's wallet client carries. */
export type QsbWithdrawalWallet = ReturnType<typeof createQsbWithdrawalClient>;
