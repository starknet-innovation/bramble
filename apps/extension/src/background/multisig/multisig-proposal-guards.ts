/**
 * Pure pre-submission guards for stored multisig proposal records: the offline
 * `(call, salt) -> id` binding, the acknowledgment demanded of proposals tracked
 * by id alone or filed under an id their call does not hash to, and the
 * chain-state gates for confirm and revoke. Nothing here
 * reads the network or the store — each guard turns an already-loaded record
 * (plus, for the state gates, a freshly read status) into either an error string
 * the handler returns verbatim or `null`. The store is untrusted input: a record
 * may have been written by an earlier version, by a hostile RPC answer, or by a
 * tampered profile, so these guards fail closed rather than repairing it.
 */
import { type MultisigProposalStatus, multisigCallMatchesId } from "@mc-wallet/multisig/chain";
import type { MultisigProposalCall, MultisigProposalRecord } from "@mc-wallet/multisig/repository";

const UNTRACKED_CALL_ADVICE = "this proposal was tracked by id only; executing needs the original ";

const CALL_ID_MISMATCH =
  "this proposal's stored call does not hash to its proposal id — re-track it from the chain before acting on it";

const RECOVERY_REVOKE_ADVICE =
  "this proposal's stored call does not hash to its proposal id, so the wallet cannot describe what it does — revoking withdraws your confirmation from that id and nothing else; check the id on a block explorer, then acknowledge to continue";

/**
 * Refuses a stored record whose call does not hash to the id it is filed under.
 *
 * A record keeps its id and its call as independent fields, so only re-hashing
 * the call offline binds them. Returns the mismatch advice when the record
 * carries a call that hashes elsewhere, and `null` otherwise — including for a
 * call-less record, which has nothing to bind and stays on the
 * {@link requireUntrackedVerification} acknowledgment path. Call this before
 * turning the stored id or the stored call into calldata that GRANTS or SPENDS
 * authority (confirm in either mode, execute): otherwise a user could review one
 * call while the wallet adds quorum to, or executes, a different on-chain
 * proposal. Withdrawing authority goes through {@link revokeRecordGuardError}
 * instead, which is deliberately recoverable.
 */
export const bindingError = (proposal: MultisigProposalRecord): string | null =>
  proposal.call !== null && !multisigCallMatchesId(proposal.call, proposal.call.salt, proposal.txId)
    ? CALL_ID_MISMATCH
    : null;

/**
 * Requires an explicit acknowledgment before acting on a proposal the wallet
 * only knows by id.
 *
 * Discovered and id-tracked proposals carry no call, so no offline check can
 * describe what they do; the user must verify them out of band. Returns advice
 * text when the acknowledgment is missing, `null` once it is given or when the
 * record carries a call.
 */
export const requireUntrackedVerification = (
  proposal: MultisigProposalRecord,
  untrackedVerified: boolean | undefined,
): string | null =>
  proposal.call === null && untrackedVerified !== true
    ? "verify this proposal on a block explorer or with the proposer, then acknowledge before confirming"
    : null;

/**
 * The record-shape guard for `revoke_confirmation`, deliberately weaker than
 * the one confirm and execute run.
 *
 * The asymmetry is in what each action signs. Confirm attributes a stored id to
 * the call the panel described, and execute signs the stored call itself, so an
 * unbound record has to be refused outright there. Revocation's calldata is the
 * id alone (`buildMultisigRevokeCall`), it never touches the stored call, and it
 * REMOVES this signer's authority rather than granting any — so refusing it
 * strands exactly the victim MCW-V09-102 exists to rescue: a legacy record whose
 * confirmed id was filed beside a call that hashes elsewhere. This returns the
 * recovery advice instead, and `null` once the caller acknowledges the id.
 *
 * The acknowledgment is not what bounds this path. Every caller runs
 * {@link revokeGuard} against a freshly read chain status for that exact id
 * afterwards, so a revocation can only be broadcast for a proposal the chain
 * still reports as live AND as confirmed by this signer; an acknowledged id the
 * signer never confirmed is refused there. Do not re-tighten this into
 * {@link bindingError} to "restore parity" with confirm — the recipient policy
 * in ./multisig-tx-ops already exempts revocation on the same reasoning.
 *
 * Acknowledging here launders nothing: confirm and execute keep reading
 * {@link bindingError} and {@link executableCall}, and revoking neither rewrites
 * the stored record nor makes its id usable by another action.
 */
export const revokeRecordGuardError = (
  proposal: MultisigProposalRecord,
  untrackedVerified: boolean | undefined,
): string | null => {
  if (proposal.call === null) {
    return requireUntrackedVerification(proposal, untrackedVerified);
  }
  return bindingError(proposal) === null || untrackedVerified === true
    ? null
    : RECOVERY_REVOKE_ADVICE;
};

/**
 * Returns the stored call an `execute_transaction` invoke may be built from.
 *
 * Fails with `missingCallAdvice` appended to the id-only explanation when the
 * record has no call, and with the binding refusal when it has one that hashes
 * to a different id ({@link bindingError}). Never throws: every disagreement is
 * a plain error string for the caller to return.
 */
export const executableCall = (
  proposal: MultisigProposalRecord,
  missingCallAdvice: string,
): MultisigProposalCall | { readonly error: string } => {
  const stored = proposal.call;
  if (!stored) {
    return { error: `${UNTRACKED_CALL_ADVICE}${missingCallAdvice}` };
  }
  const mismatch = bindingError(proposal);
  return mismatch ? { error: mismatch } : stored;
};

/**
 * Rejects a confirmation the chain state already makes pointless or invalid.
 * Returns advice text for executed, not-found, already-quorate, or
 * already-confirmed proposals, `null` when the confirmation is worth sending.
 */
export const confirmGuard = (status: MultisigProposalStatus): string | null => {
  if (status.state === "executed" || status.state === "not-found") {
    return `cannot confirm a proposal that is ${status.state}`;
  }
  if (status.state === "confirmed") {
    return "proposal already has quorum — execute it instead of adding more confirmations";
  }
  return status.confirmedBySigner ? "this account has already confirmed this proposal" : null;
};

/**
 * Rejects a revocation the chain state makes impossible: a settled proposal, or
 * one this signer never confirmed. Returns advice text, or `null` when the
 * revocation is worth sending.
 */
export const revokeGuard = (status: MultisigProposalStatus): string | null => {
  if (status.state === "executed" || status.state === "not-found") {
    return `cannot revoke a proposal that is ${status.state}`;
  }
  return status.confirmedBySigner ? null : "this account has not confirmed this proposal";
};
