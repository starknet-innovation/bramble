/**
 * Refuses a frozen Argent multisig proposal that cannot be stored.
 *
 * Threshold-1 submission uses ordinary execute and is not covered here. A
 * higher threshold freezes the calls into an intent, and that intent keeps
 * `ARGENT_MULTISIG_INVOKE_LIMITS`. Checking before the approval is queued
 * means the card is not shown for a proposal that cannot be prepared.
 */

import { ARGENT_MULTISIG_INVOKE_LIMITS } from "@bramble/starknet/multisig-invoke";
import type { Call } from "starknet";

/** Shown when a proposal has more calls than the stored intent allows. */
export const MULTISIG_PROPOSAL_CALL_LIMIT =
  "This multisig can't propose more than 16 calls in one transaction.";

/** Shown when a proposal's calldata exceeds the stored intent's felt budget. */
export const MULTISIG_PROPOSAL_CALLDATA_LIMIT =
  "This multisig can't propose that much calldata in one transaction.";

/**
 * The refusal for a higher-threshold proposal, or null when the calls fit the
 * stored budget. Counts calls and calldata only; it does not re-validate felts.
 */
export const frozenMultisigProposalRefusal = (calls: readonly Call[]): string | null => {
  if (calls.length > ARGENT_MULTISIG_INVOKE_LIMITS.calls) return MULTISIG_PROPOSAL_CALL_LIMIT;
  let total = 0;
  for (const call of calls) {
    const length = Array.isArray(call.calldata) ? call.calldata.length : 0;
    if (length > ARGENT_MULTISIG_INVOKE_LIMITS.calldataFelts)
      return MULTISIG_PROPOSAL_CALLDATA_LIMIT;
    total += length;
    if (total > ARGENT_MULTISIG_INVOKE_LIMITS.totalCalldataFelts) {
      return MULTISIG_PROPOSAL_CALLDATA_LIMIT;
    }
  }
  return null;
};
