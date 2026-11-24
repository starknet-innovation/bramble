/**
 * The `replace` block: `canReplaceArgentMultisigSigningIntent`, the rule the registry applies
 * before it overwrites a stored intent, for the transitions G5's `-refusals.json` does not already
 * pin (it has collecting to ready and to submitted, ready to submitted, a dropped signature and a
 * changed summary). Each side is recorded with whether it is a valid stored intent on its own, and
 * a refusal with `refusedBecause`: `next-invalid` (or `current-invalid`) when a side fails the
 * stored-intent validator, `transition` only when both are valid and the rule itself refuses.
 */
import {
  type ArgentMultisigSigningIntent,
  canReplaceArgentMultisigSigningIntent,
  isArgentMultisigSigningIntent,
} from "@bramble/multisig/repository";
import { CONTACT, RECIPIENT } from "../mobile-parity-calls/shared";
import { transferTo } from "./review";
import { intentFor, type Setup, withSignatures } from "./shared";

/** Every pair, both sides as compact JSON, with the verdict. */
export const computeReplacements = async (setup: Setup): Promise<readonly object[]> => {
  const proposal = await intentFor(setup, [transferTo(CONTACT)], []);
  const one = await withSignatures(setup, proposal, [1]);
  const other = await withSignatures(setup, proposal, [2]);
  const ready = await withSignatures(setup, proposal, [1, 2]);
  const readyOther = await withSignatures(setup, proposal, [0, 1]);
  const broadcast = { broadcastTransactionHash: ready.prepared.transactionHash };
  const submitted = { ...ready, ...broadcast, state: "submitted" as const };
  const accepted = { ...ready, ...broadcast, state: "accepted" as const };
  const stale = { ...one, staleReason: "nonce" as const, state: "stale" as const };
  const pairs: Readonly<
    Record<string, readonly [ArgentMultisigSigningIntent, ArgentMultisigSigningIntent]>
  > = {
    unchanged: [one, one],
    readyToAccepted: [ready, accepted],
    readyToRejected: [ready, { ...ready, ...broadcast, state: "rejected" }],
    readyToCollecting: [ready, { ...ready, state: "collecting" }],
    collectingToStale: [one, stale],
    staleToSubmitted: [stale, { ...submitted }],
    staleToCollecting: [stale, one],
    submittedToAccepted: [submitted, accepted],
    submittedToReady: [submitted, ready],
    acceptedToRejected: [accepted, { ...accepted, state: "rejected" }],
    swapsTheSignature: [one, other],
    readyWithOtherSigners: [ready, readyOther],
    changesTheSnapshot: [
      proposal,
      { ...proposal, configSnapshot: { ...proposal.configSnapshot, threshold: 3 } },
    ],
    anotherTransaction: [proposal, await intentFor(setup, [transferTo(RECIPIENT)], [])],
  };
  return Object.entries(pairs).map(([name, [current, next]]) => {
    const canReplace = canReplaceArgentMultisigSigningIntent(current, next);
    const currentValid = isArgentMultisigSigningIntent(current);
    const nextValid = isArgentMultisigSigningIntent(next);
    // Which check refuses: an invalid side fails before the transition rule is reached.
    const refusedBecause = canReplace
      ? null
      : !currentValid
        ? "current-invalid"
        : !nextValid
          ? "next-invalid"
          : "transition";
    return {
      canReplace,
      current: JSON.stringify(current),
      currentValid,
      name,
      next: JSON.stringify(next),
      nextValid,
      refusedBecause,
    };
  });
};
