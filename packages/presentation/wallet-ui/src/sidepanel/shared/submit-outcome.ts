/**
 * What a rejected submission may say about whether anything was sent.
 *
 * "Not sent" is a statement about funds, so it is made only for a closed set
 * of refusals the background raises before anything is signed or broadcast:
 * the gate's own checks, a review that moved, a fee ceiling, a poisoned
 * recipient, a privacy refusal, a device that declined. Every other rejection —
 * a lost reply, an unrecognised reply, the router's catch-all, a message this
 * list has not reviewed — may already be on chain, so it reads as outcome
 * unknown and points at Activity instead of inviting a second send (errors
 * audit F1, F2; audit 173).
 *
 * Pure: no DOM, clock, or network access.
 */

import { isLedgerRejectionCode, type LedgerRejectionCode } from "@bramble/ledger-protocol/errors";
import { STRK20_PRIOR_WRITE_UNRESOLVED } from "@bramble/privacy/maturity";
import { WRONG_CHAIN_MESSAGE } from "@bramble/starknet/provider";
import { PrivacyBlockerError } from "@bramble/wallet-protocol/privacy-blocker";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import { friendlyError } from "../runtime/friendly-error";
import {
  REQUEST_FAILED,
  REQUEST_UNKNOWN,
  UNEXPECTED_FALLBACK,
} from "../runtime/friendly-error-copy";
import { SUBMISSION_UNKNOWN } from "../runtime/friendly-error-shared";
import { errorDetails } from "./dom";

/**
 * Background refusals, lowercased, that are raised before the transaction is
 * signed or broadcast. Exact match only; adding a line here lets the panel say
 * "not sent", so each one needs the same review the list had. A message that
 * itself says nothing was submitted, signed, or sent must be listed (checked by
 * the conformance test), so it can never sit beside "may not have gone through".
 */
export const KNOWN_NOT_SENT: ReadonlySet<string> = new Set([
  // An earlier private write may still land, so this one was refused while
  // its proving block was chosen, before it claimed the pool (issue 661).
  STRK20_PRIOR_WRITE_UNRESOLVED,
  // The gate: nothing was built.
  "wallet locked",
  "no account for selected network",
  "token unavailable",
  "no calls to submit",
  "switch to the nft's network first",
  "this account does not own that nft",
  // The reviewed preparation is one-time and was not executed.
  "swap preparation not found",
  "swap preparation changed",
  "privacy preparation not found",
  "privacy preparation changed",
  "shielding route changed",
  // A swap build refused for safety before it was signed.
  "swap build touched an unexpected token approval",
  // Pool checks that run before the proof is submitted.
  "private registration is no longer active",
  "private balances are already active",
  "the recipient has not activated private balances",
  "insufficient private balance",
  "strk20 privacy leak",
  // The shared poisoned-recipient refusal (verify.ts).
  "the recipient closely mimics an address you saved or paid but is a different account. re-check every character before sending.",
  // Fee ceilings and fee reviews, checked before signing.
  "retry the fee estimate before approving this transaction",
  "couldn't estimate the network fee, so nothing was signed. try again.",
  "the network fee was not reviewed. nothing was submitted — review the transaction again.",
  "the network fee for this transaction rose above the amount you reviewed. nothing was submitted — review it again.",
  "the network fee for this declaration rose above the amount you reviewed. nothing was submitted — review it again.",
  "the account deployment fee rose above the amount you reviewed. nothing was submitted — review it again.",
  "the account deployment fee was not reviewed. nothing was submitted — deploy the account first.",
  "the transaction could not be recorded before sending. nothing was submitted — try again.",
  // The multisig deployment gate (multisig-deploy-ops.ts `submitDeployment`):
  // each is returned before the operation is claimed or anything is signed.
  "argent multisig deployment address needs strk before deployment",
  "argent multisig deployment must exactly match a fresh fee review",
  "switch to the deployment network first",
  // Key, signature, hash, chain, class, and deployment-parameter checks that
  // fail before the result is returned to be broadcast, and the revoke that is
  // refused before it is built (issue 652 copy review).
  "invalid message hash",
  "invalid transaction hash",
  "typed data cannot be hashed",
  "typed data produced an invalid hash",
  "typed data chain does not match the active network",
  "signature public key does not match the account",
  "krusty kms signature key mismatch",
  "krusty kms public-key probe did not verify",
  "ledger signature verification failed",
  "rpc endpoint chain id does not match the account network",
  "argent account class hash does not match the pinned release",
  "argent multisig class hash does not match the pinned release",
  "deployed argent multisig class does not match the pinned release",
  "declared argent multisig class does not match the stable pin",
  "supplied class hash does not match the starknet contract class",
  "account deployment parameters do not match the stored address",
  "this wallet could not confirm that contract is a token, so it will not send a revoke that could approve an nft instead; revoke it from the dapp",
  // Shadow-account record, read, and sweep-preparation refusals: each is raised
  // before a proof is prepared (records are written before the proof).
  "invalid shadow account record",
  "shadow account anonymizer changed",
  "shadow account holds no tracked token",
  "shadow account record limit reached",
  "shadow account records unavailable",
  "shadow account scope not recorded",
  "shadow sweep batch breaks a batch rule",
  "shadow_account_sweep_unavailable",
  // Endpoint refusals raised before the broadcast.
  "the rpc endpoint refused this request (rate limit or gateway rejection). nothing was submitted - wait a moment and try again.",
  WRONG_CHAIN_MESSAGE.toLowerCase(),
]);

/**
 * Ledger answers that arrive before the device has signed. Not here: a chain
 * failure (it was sent), a wallet restart mid-sign, a sign still waiting, and
 * the catch-all device error, which a wallet-side failure after the device
 * signed also becomes.
 */
const PRE_SIGNATURE_LEDGER_CODES: ReadonlySet<LedgerRejectionCode> = new Set([
  "app-below-minimum",
  "blind-signing-disabled",
  "dashboard-restore-failed",
  "deploy-unfunded",
  "device-busy",
  "device-locked",
  "disconnected-mid-sign",
  "firmware-below-minimum",
  "locked-mid-sign",
  "management-refused",
  "management-unreadable",
  "multiple-devices",
  "network-mismatch",
  "no-app-open",
  "panel-context-lost",
  "picker-cancelled",
  "rejected-on-device",
  "replug",
  "signature-verify-failed",
  "starknet-reopen-failed",
  "unsupported-ledger-device",
  "webhid-unavailable",
  "wrong-device",
]);

// Every "invalid <...> request" refusal is the router's input parse.
const PARSE_REFUSAL = /^invalid .+ request$/;

/**
 * Whether a rejected submission is known not to have been sent. Closed: a
 * {@link SubmissionUnknownError} never is, a curated privacy prerequisite (any
 * kind but `service`) always is, and otherwise only the exact messages above,
 * the router's input-parse refusals, and the pre-signature Ledger codes are.
 */
export const knownNotSent = (error: unknown): boolean => {
  if (!(error instanceof Error) || error instanceof SubmissionUnknownError) return false;
  if (error instanceof PrivacyBlockerError) return error.kind !== "service";
  const raw = error.message.trim();
  if (isLedgerRejectionCode(raw)) return PRE_SIGNATURE_LEDGER_CODES.has(raw);
  const normalized = raw.toLowerCase();
  return KNOWN_NOT_SENT.has(normalized) || PARSE_REFUSAL.test(normalized);
};

/**
 * Whether a rejection is the privacy runtime's refusal over an EARLIER write
 * that may still land. The refused attempt sent nothing (it is also
 * {@link knownNotSent}); Send names that and offers Check again, which
 * prepares afresh and so re-runs the background's resolution of the earlier
 * write. A typed unknown outcome never matches.
 */
export const priorWriteUnresolved = (error: unknown): boolean =>
  error instanceof Error &&
  !(error instanceof SubmissionUnknownError) &&
  error.message.trim() === STRK20_PRIOR_WRITE_UNRESOLVED;

// Sentences that carry nothing beyond "it didn't work": beside an unknown
// outcome they would only invite the retry the unknown sentence warns about.
const NO_DETAIL: ReadonlySet<string> = new Set([
  "",
  UNEXPECTED_FALLBACK,
  REQUEST_FAILED,
  REQUEST_UNKNOWN,
]);

// A detail that already says the outcome is unknown stands on its own.
const ALREADY_UNKNOWN =
  /(?:check activity before trying again\.|status is unknown|could not be confirmed)/i;

/**
 * The reason line for a submission whose outcome is unknown. `subject` names
 * it ("The transfer", "The swap"). The background's own sentence comes first
 * when it says something (a revert, a network failure), so no fact is hidden;
 * one that already says the outcome is unknown is shown alone; a generic one
 * is replaced, since its "try again" would contradict "check Activity first".
 */
export const outcomeUnknownReason = (error: unknown, subject: string): string => {
  const unknown = SUBMISSION_UNKNOWN(subject);
  // A typed unknown outcome carries a curated sentence; it is shown as is
  // unless it is the generic one, which this subject can say better.
  const typed = error instanceof SubmissionUnknownError;
  const detail = typed ? error.message : friendlyError(errorDetails(error, "")).message;
  if (NO_DETAIL.has(detail)) return unknown;
  if (typed || ALREADY_UNKNOWN.test(detail)) return detail;
  return `${detail} ${unknown}`;
};
