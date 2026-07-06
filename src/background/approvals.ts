/**
 * Background-only dapp approval queue. Requests are intentionally not persisted.
 */
import { WalletError } from "../shared/errors";
import { isUuid } from "../shared/ids";
import { isWalletOrigin } from "../shared/origin";

/**
 * Maximum queued dapp connection approvals kept in background memory.
 */
export const MAX_PENDING_APPROVALS = 50;

/**
 * Pending dapp connection approval.
 */
export type PendingApproval = {
  readonly id: string;
  readonly origin: string;
};

/**
 * In-memory dapp connection approval queue.
 */
export type ApprovalQueue = {
  readonly approve: (id: string) => PendingApproval | null;
  readonly deny: (id: string) => PendingApproval | null;
  readonly get: (id: string) => PendingApproval | null;
  readonly list: () => readonly PendingApproval[];
  readonly request: (origin: string) => PendingApproval;
};

const approvalSnapshot = (approval: PendingApproval): PendingApproval => ({
  id: approval.id,
  origin: approval.origin,
});

/**
 * Creates a deduplicating approval queue keyed by requesting origin.
 */
export const createApprovalQueue = (): ApprovalQueue => {
  const pending = new Map<string, PendingApproval>();

  const get = (id: string): PendingApproval | null => {
    if (!isUuid(id)) {
      return null;
    }

    const approval = pending.get(id) ?? null;
    return approval ? approvalSnapshot(approval) : null;
  };

  const remove = (id: string): PendingApproval | null => {
    const approval = get(id);
    pending.delete(id);
    return approval;
  };

  return {
    approve: remove,
    deny: remove,
    get,
    list() {
      return [...pending.values()].map(approvalSnapshot);
    },
    request(origin) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      const existing = [...pending.values()].find((approval) => approval.origin === origin);
      if (existing) {
        return approvalSnapshot(existing);
      }
      if (pending.size >= MAX_PENDING_APPROVALS) {
        throw new WalletError("Too many pending approvals");
      }

      const approval = { id: crypto.randomUUID(), origin };
      pending.set(approval.id, approval);
      return approvalSnapshot(approval);
    },
  };
};
