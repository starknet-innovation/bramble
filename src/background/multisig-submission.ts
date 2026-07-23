/**
 * Durable multisig submission claims and best-effort post-broadcast
 * bookkeeping. A claim is persisted before a fee-paying declare/deploy call,
 * closing the double-click/two-panel race. Once an RPC returns a transaction
 * hash, bookkeeping failures never turn that accepted submission into a false
 * failure response.
 */
import type { ActivityLog } from "../storage/activity-store";
import { type MultisigOperationRecord, multisigOperationId } from "../storage/multisig-store";
import type { MultisigOpsDeps } from "./multisig-ops";

type OperationClaimInput = {
  readonly accountId: string;
  readonly kind: MultisigOperationRecord["kind"];
  readonly networkId: MultisigOperationRecord["networkId"];
  readonly pendingError: string;
  readonly target: string;
};

type OperationKeyInput = Omit<OperationClaimInput, "pendingError">;

type OperationClaim = { readonly error: string } | { readonly operationId: string };

const pendingClaimError = (message: string, transactionHash: string | undefined): string =>
  transactionHash ? `${message} (${transactionHash})` : message;

/**
 * Atomically claims one declare/deploy configuration. A rejected or reverted
 * prior transaction releases its claim for retry; pending, accepted, unknown,
 * or unreadable state remains blocked so deduplication fails closed.
 */
export const claimMultisigOperation = async (
  deps: MultisigOpsDeps,
  input: OperationClaimInput,
): Promise<OperationClaim> => {
  const operationId = multisigOperationId(
    input.kind,
    input.networkId,
    input.accountId,
    input.target,
  );
  if (!operationId) {
    return { error: "invalid multisig operation claim" };
  }
  try {
    const operations = await deps.multisigStore.listOperations();
    const entries = await deps.activity.list().catch(() => []);
    const statuses = new Map(entries.map((entry) => [entry.hash, entry.status]));
    await Promise.all(
      operations
        .filter(
          (operation) =>
            operation.id !== operationId &&
            operation.transactionHash !== undefined &&
            statuses.get(operation.transactionHash) !== undefined &&
            statuses.get(operation.transactionHash) !== "pending",
        )
        .map((operation) => deps.multisigStore.releaseOperation(operation.id)),
    );
    const existing = operations.find((operation) => operation.id === operationId);
    if (existing) {
      const status = existing.transactionHash ? statuses.get(existing.transactionHash) : undefined;
      if (status === "rejected" || status === "reverted") {
        await deps.multisigStore.releaseOperation(operationId);
      } else {
        return {
          error: pendingClaimError(input.pendingError, existing.transactionHash),
        };
      }
    }
    const claim = await deps.multisigStore.claimOperation({
      accountId: input.accountId,
      id: operationId,
      kind: input.kind,
      networkId: input.networkId,
      target: input.target,
    });
    if (claim === "claimed") {
      return { operationId };
    }
    return {
      error:
        claim === "full"
          ? "too many multisig operations are still unresolved — wait for them to settle"
          : input.pendingError,
    };
  } catch {
    return { error: "could not reserve this multisig operation — try again" };
  }
};

/**
 * Releases a pre-broadcast claim after the RPC rejects. Failure is ignored:
 * retaining a stale claim fails closed, while reporting an unbroadcast request
 * as successful would be incorrect.
 */
export const releaseMultisigOperation = async (
  deps: MultisigOpsDeps,
  operationId: string,
): Promise<void> => {
  await deps.multisigStore.releaseOperation(operationId).catch(() => undefined);
};

/**
 * Clears a claim once an authoritative chain read proves the class/address is
 * already present. This keeps successful historical operations from occupying
 * the bounded claim registry.
 */
export const clearCompletedMultisigOperation = async (
  deps: MultisigOpsDeps,
  input: OperationKeyInput,
): Promise<void> => {
  const operationId = multisigOperationId(
    input.kind,
    input.networkId,
    input.accountId,
    input.target,
  );
  if (operationId) {
    await releaseMultisigOperation(deps, operationId);
  }
};

/**
 * Records public activity after broadcast and reports whether persistence
 * succeeded, without allowing failure to discard the caller's transaction
 * hash.
 */
export const recordSubmittedActivity = async (
  activity: ActivityLog,
  entry: Parameters<ActivityLog["record"]>[0],
): Promise<boolean> => {
  try {
    await activity.record(entry);
    return true;
  } catch {
    return false;
  }
};

/**
 * Attaches the returned transaction hash to its durable claim and mirrors it
 * into Activity. Both writes are best-effort after broadcast; the original
 * claim remains a fail-closed dedup marker if either write is interrupted.
 */
export const recordClaimedMultisigSubmission = async (
  deps: MultisigOpsDeps,
  operationId: string,
  entry: Parameters<ActivityLog["record"]>[0],
): Promise<void> => {
  const hashRecorded = await deps.multisigStore.setOperationHash(operationId, entry.hash).then(
    () => true,
    () => false,
  );
  const activityRecorded = await recordSubmittedActivity(deps.activity, entry);
  if (!hashRecorded && activityRecorded) {
    await releaseMultisigOperation(deps, operationId);
  }
};
