/**
 * Background-only dapp approval queue. Requests are intentionally not persisted.
 */
import { WalletError } from "../shared/errors";
import { isUuid } from "../shared/ids";
import { isWalletOrigin } from "../shared/origin";
import type { StarknetNetworkId } from "../starknet/networks";

/**
 * Maximum queued dapp connection approvals kept in background memory.
 */
export const MAX_PENDING_APPROVALS = 50;

/**
 * Approval kinds distinguishing a connection prompt from a watch-asset prompt.
 */
export type ApprovalKind = "connect" | "watch-asset";

/**
 * ERC20 token metadata carried by a watch-asset approval, in the shape the
 * preferences store accepts when the request is approved.
 */
export type WatchAssetToken = {
  readonly address: string;
  readonly decimals: number;
  readonly name: string;
  readonly networkId: StarknetNetworkId;
  readonly symbol: string;
};

/**
 * Pending dapp approval. `kind` and `token` describe watch-asset prompts;
 * `blocked` and `insights` are attached by the reputation layer when the
 * queue is listed to the UI — the queue itself never sets them.
 */
export type PendingApproval = {
  readonly blocked?: boolean;
  readonly id: string;
  readonly insights?: readonly string[];
  readonly kind: ApprovalKind;
  readonly origin: string;
  readonly token?: WatchAssetToken;
};

/**
 * In-memory dapp approval queue for connection and watch-asset prompts.
 */
export type ApprovalQueue = {
  readonly approve: (id: string) => PendingApproval | null;
  readonly deny: (id: string) => PendingApproval | null;
  readonly get: (id: string) => PendingApproval | null;
  readonly list: () => readonly PendingApproval[];
  readonly request: (origin: string) => PendingApproval;
  readonly requestWatchAsset: (input: {
    readonly origin: string;
    readonly token: WatchAssetToken;
  }) => PendingApproval;
};

const approvalSnapshot = (approval: PendingApproval): PendingApproval => ({
  id: approval.id,
  kind: approval.kind,
  origin: approval.origin,
  ...(approval.token === undefined ? {} : { token: { ...approval.token } }),
});

/**
 * Creates a deduplicating approval queue. Connection prompts dedupe per origin;
 * watch-asset prompts dedupe per origin and token address so different tokens
 * from the same site queue independently.
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

  const enqueue = (approval: PendingApproval): PendingApproval => {
    if (pending.size >= MAX_PENDING_APPROVALS) {
      throw new WalletError("Too many pending approvals");
    }
    pending.set(approval.id, approval);
    return approvalSnapshot(approval);
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

      const existing = [...pending.values()].find(
        (approval) => approval.kind === "connect" && approval.origin === origin,
      );
      if (existing) {
        return approvalSnapshot(existing);
      }
      return enqueue({ id: crypto.randomUUID(), kind: "connect", origin });
    },
    requestWatchAsset({ origin, token }) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      const existing = [...pending.values()].find(
        (approval) =>
          approval.kind === "watch-asset" &&
          approval.origin === origin &&
          approval.token?.address === token.address &&
          approval.token?.networkId === token.networkId,
      );
      if (existing) {
        return approvalSnapshot(existing);
      }
      return enqueue({ id: crypto.randomUUID(), kind: "watch-asset", origin, token: { ...token } });
    },
  };
};
