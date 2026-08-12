/**
 * Durable multisig submission claims and best-effort post-broadcast
 * bookkeeping. A claim is persisted before a fee-paying declare/deploy call,
 * closing the double-click/two-panel race. Once an RPC returns a transaction
 * hash, bookkeeping failures never turn that accepted submission into a false
 * failure response.
 */

import { type MultisigOperationRecord, multisigOperationId } from "@mc-wallet/multisig/repository";
import { type ActivityLog, isUnresolvedActivityStatus } from "@mc-wallet/transactions/activity";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
import type { MultisigOpsDeps } from "./multisig-ops";

type SetupOperationKind = Extract<MultisigOperationRecord["kind"], "declare" | "deploy">;

type OperationClaimInput = {
  readonly accountId: string;
  readonly kind: SetupOperationKind;
  readonly networkId: MultisigOperationRecord["networkId"];
  readonly pendingError: string;
  readonly target: string;
};

type OperationKeyInput = Omit<OperationClaimInput, "pendingError">;

type OperationClaim = { readonly error: string } | { readonly operationId: string };

/**
 * Proposal actions serialized per signer, watched multisig, and tx id.
 */
export type MultisigProposalOperationKind = Extract<
  MultisigOperationRecord["kind"],
  "confirm" | "execute" | "revoke"
>;

type ProposalOperationClaimInput = {
  readonly accountId: string;
  readonly kind: MultisigProposalOperationKind;
  readonly multisigId: string;
  readonly networkId: MultisigOperationRecord["networkId"];
  readonly pendingError: string;
  readonly txId: string;
};

const pendingClaimError = (message: string, transactionHash: string | undefined): string =>
  transactionHash ? `${message} (${transactionHash})` : message;

/**
 * Atomically claims one declare/deploy configuration. A rejected or reverted
 * prior transaction releases its claim for retry; unresolved (pending or
 * pre-confirmed), accepted, unknown, or unreadable state remains blocked so
 * deduplication fails closed. A pre-confirmation is provisional, so it must
 * hold the claim exactly like a pending transaction does.
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
    const resolved = (transactionHash: string | undefined): boolean => {
      const status = transactionHash === undefined ? undefined : statuses.get(transactionHash);
      return status !== undefined && !isUnresolvedActivityStatus(status);
    };
    await Promise.all(
      operations
        .filter(
          (operation) =>
            (operation.kind === "declare" || operation.kind === "deploy") &&
            operation.id !== operationId &&
            resolved(operation.transactionHash),
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

const isProposalOperation = (
  operation: MultisigOperationRecord,
): operation is MultisigOperationRecord & { readonly kind: MultisigProposalOperationKind } =>
  operation.kind === "confirm" || operation.kind === "execute" || operation.kind === "revoke";

/**
 * Atomically reserves one signer action for a proposal, scoped to the watched
 * multisig it runs against: transaction ids hash `(call, salt)` and not the
 * contract, so the same id can name a live proposal on two different multisigs
 * and neither may block the other.
 *
 * Any unresolved or unreadable prior claim for that `(signer, multisig, txId)`
 * stays blocked, whatever its kind. Kind-separated claims used to let an
 * execute and a revoke broadcast together: the state each one validated was
 * read while the other was still unmined, so both passed their gates and both
 * paid a fee for a pair of transactions that contradict each other. A claim
 * still carrying no transaction hash may be racing a broadcast or may have lost
 * its post-broadcast bookkeeping write, so it also blocks every kind. Legacy
 * claims carry no multisig and block every contract, which fails closed for the
 * one upgrade during which they can still be in flight. Rejected/reverted
 * submissions are retryable; an accepted inverse action releases older
 * accepted claims.
 */
export const claimMultisigProposalOperation = async (
  deps: MultisigOpsDeps,
  input: ProposalOperationClaimInput,
): Promise<OperationClaim> => {
  const operationId = multisigOperationId(
    input.kind,
    input.networkId,
    input.accountId,
    input.txId,
    input.multisigId,
  );
  if (!operationId) {
    return { error: "invalid multisig proposal operation claim" };
  }
  try {
    const [operations, entries] = await Promise.all([
      deps.multisigStore.listOperations(),
      deps.activity.list().catch(() => []),
    ]);
    const activityByHash = new Map(entries.map((entry) => [entry.hash, entry]));
    const matchesSignerProposal = (operation: MultisigOperationRecord): boolean =>
      isProposalOperation(operation) &&
      operation.accountId === input.accountId &&
      operation.networkId === input.networkId &&
      (operation.multisigId === undefined || operation.multisigId === input.multisigId) &&
      sameFelt(operation.target, input.txId);
    const sameSignerProposal = operations.filter(matchesSignerProposal);
    const settledElsewhere = operations.filter((operation) => {
      if (!isProposalOperation(operation) || matchesSignerProposal(operation)) return false;
      const status = operation.transactionHash
        ? activityByHash.get(operation.transactionHash)?.status
        : undefined;
      return status !== undefined && !isUnresolvedActivityStatus(status);
    });
    const accepted = sameSignerProposal
      .map((operation) => ({
        activity: operation.transactionHash
          ? activityByHash.get(operation.transactionHash)
          : undefined,
        operation,
      }))
      .filter((entry) => entry.activity?.status === "accepted")
      .sort(
        (left, right) => (left.activity?.submittedAt ?? 0) - (right.activity?.submittedAt ?? 0),
      );
    const latestAccepted = accepted.at(-1)?.operation.id;
    const existing = sameSignerProposal.find(
      (operation) => operation.id === operationId && operation.id === latestAccepted,
    );
    await Promise.all([
      ...settledElsewhere.map((operation) => deps.multisigStore.releaseOperation(operation.id)),
      ...sameSignerProposal
        .filter((operation) => {
          const activity = operation.transactionHash
            ? activityByHash.get(operation.transactionHash)
            : undefined;
          return (
            activity?.status === "rejected" ||
            activity?.status === "reverted" ||
            (activity?.status === "accepted" && operation.id !== existing?.id)
          );
        })
        .map((operation) => deps.multisigStore.releaseOperation(operation.id)),
    ]);
    if (existing) {
      return {
        error: pendingClaimError(input.pendingError, existing.transactionHash),
      };
    }
    // Every unresolved claim is kind-blind. In particular, no hash does NOT
    // prove no broadcast: the worker can be torn down after the RPC answers but
    // before the best-effort hash write. Availability must lose to duplicate or
    // contradictory signing when the outcome is unknowable.
    const unresolved = sameSignerProposal.find((operation) => {
      if (operation.transactionHash === undefined) return true;
      const status = activityByHash.get(operation.transactionHash)?.status;
      return status === undefined || isUnresolvedActivityStatus(status);
    });
    if (unresolved) {
      return {
        error: pendingClaimError(input.pendingError, unresolved.transactionHash),
      };
    }
    // This store mutation repeats the kind-blind conflict check atomically with
    // the write. The reads above provide cleanup and a useful hash in the error;
    // they are not the concurrency control.
    const claim = await deps.multisigStore.claimProposalOperation({
      accountId: input.accountId,
      id: operationId,
      kind: input.kind,
      multisigId: input.multisigId,
      networkId: input.networkId,
      target: input.txId,
    });
    if (claim === "claimed") return { operationId };
    return {
      error:
        claim === "full"
          ? "too many multisig operations are still unresolved — wait for them to settle"
          : input.pendingError,
    };
  } catch {
    return { error: "could not reserve this multisig proposal action — try again" };
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
  await deps.multisigStore.setOperationHash(operationId, entry.hash).catch(() => undefined);
  await recordSubmittedActivity(deps.activity, entry);
};
