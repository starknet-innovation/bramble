/**
 * The contract the background and the wallet UI share for withdrawing a QSB
 * deposit: a deposit's withdrawal as the UI may see it, the quote, the
 * release review, the bounds both sides enforce, and the refusal diagnostics
 * the background throws and the UI translates. Shapes and constants only;
 * whoever receives a reply validates it again before trusting it.
 *
 * A withdrawal spends one funded deposit plus one helper output of the QSB
 * vault's owner address to a single destination, in one transaction `T`
 * fixed before the coordinator's GPU search runs. Once the search finds a
 * solution, the user reviews `T` and authorizes the release of exactly 15
 * one-time secrets. That disclosure happens once per deposit, ever: only the
 * exact same `T` may be retried, and nothing can change its fee or
 * destination afterwards.
 *
 * The messages, all for extension pages only and never reachable by a site:
 * - `wallet.quoteQsbWithdrawal` `{ accountId, v, destination }`: what
 *   withdrawing deposit `v` to `destination` would pay and cost now. Reads
 *   only.
 * - `wallet.startQsbWithdrawal` `{ accountId, v, destination, feeSat }`:
 *   fixes the withdrawal (its helper output, destination and fee) and starts
 *   the coordinator's search. `feeSat` is the fee the user accepted; anything
 *   else now is refused as `quoteChanged`.
 * - `wallet.reviewQsbWithdrawal` `{ accountId, v }`: once the search is done,
 *   the release review computed from `T` and its verified previous
 *   transactions. Discloses nothing.
 * - `wallet.releaseQsbWithdrawal` `{ accountId, v, digest }` plus the wallet
 *   password, re-entered in the request and never taken from the session:
 *   the user's authorization. `digest` is the review's, so only what was
 *   reviewed is released. Records the disclosure, releases the 15 secrets,
 *   builds, signs and submits the withdrawal.
 * - `wallet.resendQsbWithdrawal` `{ accountId, v }`: sends the same signed
 *   withdrawal again, never a new one.
 * `wallet.qsbVaults` reports each deposit's withdrawal in its `withdrawal`
 * field (`QsbWithdrawalView`).
 */

/** One-time secrets a withdrawal releases: 8 of round 0 and 7 of round 1. */
export const QSB_DISCLOSED_SECRETS = 15;

/**
 * The withdrawal fee rate, as a multiple of the miner floor at quote time.
 * The fee is fixed before a search that can take hours and can never change
 * after disclosure, so it carries headroom against the floor rising.
 */
export const QSB_WITHDRAWAL_FEE_MULTIPLIER = 2;

/**
 * Where a deposit's withdrawal stands.
 * - `none`: not started.
 * - `searching`: the coordinator is looking for a solution.
 * - `paused`: the search is paused on the coordinator's side.
 * - `failed`: the search failed. Nothing was disclosed and the funds stay in
 *   the deposit, but it can't be withdrawn through the service.
 * - `ready`: a solution is waiting for the user's review and release.
 * - `pending`: released and signed here, not yet known to have reached MARA.
 * - `uncertain`: the coordinator could not say whether MARA has it.
 * - `submitted`: MARA has it.
 * - `confirmed`: mined.
 * - `conflict`: something else spent the deposit.
 */
export type QsbWithdrawalStatus =
  | "conflict"
  | "confirmed"
  | "failed"
  | "none"
  | "paused"
  | "pending"
  | "ready"
  | "searching"
  | "submitted"
  | "uncertain";

/**
 * One deposit's withdrawal as the UI may see it: public chain data only.
 * Every field but `status` is null while the status is `none`; `txid` and
 * `confirmations` are null until a transaction exists.
 */
export type QsbWithdrawalView = {
  readonly confirmations: number | null;
  readonly destination: string | null;
  readonly feeSat: number | null;
  readonly outputSat: number | null;
  readonly status: QsbWithdrawalStatus;
  readonly txid: string | null;
};

/**
 * What a withdrawal would pay and cost now. `feeRate` is sat/vB as decimal
 * text; `outputSat` is `fundingSat + helperSat - feeSat`, all of it to
 * `destination`.
 */
export type QsbWithdrawalQuote = {
  readonly destination: string;
  readonly feeRate: string;
  readonly feeSat: number;
  readonly fundingSat: number;
  readonly helperSat: number;
  readonly outputSat: number;
  readonly vsize: number;
};

/**
 * The release review the BIP requires before any secret leaves. Every value is
 * computed by the background from `T` and the previous transactions it
 * verified, never taken from the coordinator. `binding` is `unverified`:
 * Bramble checks `T` but does not independently verify that the released
 * secrets authorize only this transaction, and the UI must say so
 * prominently. `digest` is the disclosure digest `D` the release must echo.
 */
export type QsbWithdrawalReview = {
  readonly binding: "unverified";
  readonly destination: string;
  readonly digest: string;
  readonly feeSat: number;
  readonly fundingSat: number;
  readonly helperSat: number;
  readonly network: "bitcoin-mainnet";
  readonly outputSat: number;
  readonly secrets: typeof QSB_DISCLOSED_SECRETS;
  readonly v: number;
  readonly vsize: number;
};

/**
 * How the coordinator answered a submitted withdrawal. `uncertain` covers a
 * lost or unclear answer: never build another transaction, only resend the
 * same one.
 */
export type QsbWithdrawalSubmission = "conflict" | "confirmed" | "submitted" | "uncertain";

/**
 * The diagnostics the background throws when it refuses a QSB withdrawal
 * request. Coordinator-level refusals (`accessNeeded`,
 * `coordinatorUnavailable`, …) reuse `QSB_VAULT_REFUSALS`. The UI's copy table
 * matches each one exactly, so changing one here changes both sides.
 */
export const QSB_WITHDRAWAL_REFUSALS = {
  bindingRefused: "qsb withdrawal transaction does not check out",
  destinationInvalid: "invalid qsb withdrawal destination",
  dustOutput: "qsb withdrawal output is too small",
  floorRisen: "qsb withdrawal fee is below the miner floor",
  helperNeeded: "qsb withdrawal needs a helper output",
  jobRefused: "qsb withdrawal was refused",
  notReady: "qsb withdrawal is not ready",
  notWithdrawable: "qsb deposit cannot be withdrawn",
  quoteChanged: "qsb withdrawal quote changed",
  reviewChanged: "qsb withdrawal review changed",
} as const;
