/**
 * QSB withdrawal fixtures for the UI Lab: a funded deposit in each withdrawal
 * state, a quote, the release review and each release outcome, all in the
 * exact shapes the background sends. The destination is BIP-173's public
 * P2WSH example and the withdrawal's txid a public one; nothing here is a
 * wallet's own address, a real disclosure or a real transaction.
 */
import type { QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import type { QsbWithdrawalStatus } from "@bramble/wallet-model/qsb-withdrawals";
import {
  deposited,
  type QsbLabReview,
  type QsbLabWithdrawalQuote,
  type QsbLabWithdrawalResult,
} from "./qsb-vault-fixtures";

/** BIP-173's mainnet P2WSH example: a destination that is not the owner address. */
export const LAB_DESTINATION = "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3";

const WITHDRAWAL_TXID = "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16";

const RELEASED: readonly QsbWithdrawalStatus[] = ["confirmed", "pending", "submitted", "uncertain"];

/**
 * A funded deposit at index `v` whose withdrawal is in `status`: to the lab
 * destination at 900 sat, receiving the deposit plus a 10,000 sat helper.
 */
export const withdrawing = (v: number, status: QsbWithdrawalStatus): QsbVaultView => ({
  ...deposited(v, "confirmed"),
  state: RELEASED.includes(status) || status === "conflict" ? "exposed" : "allocated",
  withdrawal: {
    confirmations: status === "confirmed" ? 2 : null,
    destination: LAB_DESTINATION,
    feeSat: 900,
    outputSat: 109_100,
    status,
    txid: RELEASED.includes(status) ? WITHDRAWAL_TXID : null,
  },
});

/** One deposit per withdrawal state, in index order. */
export const EVERY_WITHDRAWAL: readonly QsbVaultView[] = (
  [
    "searching",
    "paused",
    "failed",
    "ready",
    "pending",
    "submitted",
    "uncertain",
    "confirmed",
    "conflict",
  ] as const
).map((status, v) => withdrawing(v, status));

/** A quote withdrawing the 0.001 BTC deposit plus 10,000 sat at 4 sat/vB. */
export const WITHDRAWAL_QUOTE: QsbLabWithdrawalQuote = {
  destination: LAB_DESTINATION,
  feeRate: "4",
  feeSat: 900,
  fundingSat: 100_000,
  helperSat: 10_000,
  outputSat: 109_100,
  vsize: 225,
};

/** The release review of deposit `v`'s withdrawal at that quote's terms. */
export const labReview = (v: number): QsbLabReview => ({
  binding: "unverified",
  destination: LAB_DESTINATION,
  digest: "ab".repeat(32),
  feeSat: 900,
  fundingSat: 100_000,
  helperSat: 10_000,
  network: "bitcoin-mainnet",
  outputSat: 109_100,
  secrets: 15,
  v,
  vsize: 1_180,
});

/** Each release outcome for deposit `v`, in the shape the background sends. */
export const releaseOutcome = (
  v: number,
  submission: QsbLabWithdrawalResult["submission"],
): QsbLabWithdrawalResult => ({ submission, vault: withdrawing(v, submission) });
