/**
 * Resolving an Argent multisig submission that may already be in flight.
 *
 * Split from ./multisig-tx-ops because it answers a different question from the
 * handlers there: not "may this signer act?" but "did a previous attempt already
 * broadcast, and can this one claim the slot?". An unresolved outcome fails
 * closed rather than risking a second broadcast of the same intent.
 */

import {
  type ArgentMultisigSigningIntent,
  argentMultisigOperationId,
} from "@mc-wallet/multisig/repository";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import type { MultisigOpsDeps } from "./multisig-deps";
import type { readSubmitIntentInput } from "./multisig-inputs";
import { currentArgentIntentContext } from "./multisig-intent-context";
import { recoverSubmittedArgentIntent } from "./multisig-operation-recovery";

/**
 * Either a response to return immediately, or the claimed slot and live context a
 * submission may proceed with.
 */
export type ResolvedSubmission =
  | { readonly response: RuntimeResponse }
  | {
      readonly intent: ArgentMultisigSigningIntent;
      readonly authorized: ReturnType<typeof captureSessionAuthorization>;
      readonly operationId: string;
      readonly resolved: Exclude<
        Awaited<ReturnType<typeof currentArgentIntentContext>>,
        { error: string }
      >;
    };

const existingSubmissionResponse = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
  operationId: string,
): Promise<RuntimeResponse | null> => {
  const existing = await deps.multisigStore.getOperation(operationId);
  const transactionHash = existing?.transactionHash ?? intent.broadcastTransactionHash;
  if (transactionHash) return { intent, ok: true, transactionHash };
  const recovered = await recoverSubmittedArgentIntent(deps, intent, operationId);
  if (recovered.kind === "submitted") {
    return {
      intent: recovered.intent,
      ok: true,
      transactionHash: recovered.intent.prepared.transactionHash,
    };
  }
  if (recovered.kind === "unknown") {
    return { error: "Argent multisig submission outcome is unresolved" };
  }
  await deps.multisigStore.releaseOperation(operationId);
  const reclaimed = await deps.multisigStore.claimOperation({
    accountId: intent.accountId,
    id: operationId,
    kind: "submit",
    target: intent.prepared.transactionHash,
  });
  return reclaimed === "claimed"
    ? null
    : { error: "The previous submission did not reach Starknet. Try again." };
};

const claimSubmission = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
  operationId: string,
): Promise<RuntimeResponse | null> => {
  const claim = await deps.multisigStore.claimOperation({
    accountId: intent.accountId,
    id: operationId,
    kind: "submit",
    target: intent.prepared.transactionHash,
  });
  if (claim === "exists") return existingSubmissionResponse(deps, intent, operationId);
  return claim === "claimed" ? null : { error: `Argent multisig submission claim ${claim}` };
};

const knownSubmissionResponse = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
  operationId: string,
): Promise<RuntimeResponse | null> => {
  const transactionHash =
    intent.broadcastTransactionHash ??
    (await deps.multisigStore.getOperation(operationId))?.transactionHash;
  if (!transactionHash) return null;
  const submitted: ArgentMultisigSigningIntent = {
    ...intent,
    broadcastTransactionHash: transactionHash,
    state: intent.state === "accepted" || intent.state === "rejected" ? intent.state : "submitted",
  };
  await deps.multisigStore.upsertIntent(submitted).catch(() => "invalid" as const);
  return { intent: submitted, ok: true, transactionHash };
};

/**
 * Claims the submission slot for one Argent multisig intent, or returns the
 * response to hand back instead.
 *
 * Fails closed: an outcome it cannot resolve is reported as unresolved rather
 * than retried, because a second broadcast of the same intent is worse than a
 * request the user has to repeat.
 */
export const resolveSubmission = async (
  deps: MultisigOpsDeps,
  input: NonNullable<ReturnType<typeof readSubmitIntentInput>>,
): Promise<ResolvedSubmission> => {
  const authorized = captureSessionAuthorization(deps.session);
  const intent = await deps.multisigStore.getIntent(input.intentId);
  if (intent?.state !== "ready" && intent?.state !== "stale" && intent?.state !== "submitted") {
    return {
      response: { error: intent ? "Argent multisig intent is not ready" : "intent not found" },
    };
  }
  const operationId = argentMultisigOperationId(
    "submit",
    intent.accountId,
    intent.prepared.transactionHash,
  );
  if (!operationId) {
    return { response: { error: "invalid Argent multisig submission claim" } };
  }
  const known = await knownSubmissionResponse(deps, intent, operationId);
  if (known) return { response: known };
  const resolved = await currentArgentIntentContext(deps, intent);
  if ("error" in resolved || !authorized.isCurrent()) {
    return { response: "error" in resolved ? resolved : { error: "wallet locked" } };
  }
  if (intent.signatures.length !== intent.configSnapshot.threshold) {
    return { response: { error: "Argent multisig threshold is not satisfied" } };
  }
  const response = await claimSubmission(deps, intent, operationId);
  if (response) return { response };
  return { authorized, intent, operationId, resolved };
};
