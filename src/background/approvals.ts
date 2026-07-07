/**
 * Background-only dapp approval queue. Requests are intentionally not persisted.
 */
import type { Call } from "starknet";
import { WalletError } from "../shared/errors";
import { isUuid } from "../shared/ids";
import { isWalletOrigin } from "../shared/origin";
import type { StarknetNetworkId } from "../starknet/networks";

/**
 * Maximum queued dapp connection approvals kept in background memory.
 */
export const MAX_PENDING_APPROVALS = 50;

/**
 * Approval kinds distinguishing a connection prompt, a watch-asset prompt, and
 * a per-transaction invoke prompt that must be signed off before it executes.
 */
export type ApprovalKind = "connect" | "invoke" | "sign-typed-data" | "watch-asset";

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
 * One decoded, user-facing risk flag surfaced on an invoke approval card.
 */
export type ApprovalRiskFlag = {
  readonly code: string;
  readonly message: string;
};

/**
 * Pending dapp approval. `kind` and `token` describe watch-asset prompts;
 * `summaries`/`flags` describe an invoke prompt's decoded calls and risk flags;
 * `blocked` and `insights` are attached by the reputation layer when the queue
 * is listed to the UI — the queue itself never sets them.
 */
export type PendingApproval = {
  readonly blocked?: boolean;
  readonly flags?: readonly ApprovalRiskFlag[];
  readonly id: string;
  readonly insights?: readonly string[];
  readonly kind: ApprovalKind;
  readonly origin: string;
  readonly summaries?: readonly string[];
  readonly token?: WatchAssetToken;
};

/**
 * Execution payload held privately for an invoke approval. The raw calls never
 * cross to the UI snapshot; the background reads them at approve time to submit.
 */
export type ApprovalPayload = {
  readonly calls?: readonly Call[];
  readonly typedData?: unknown;
};

type ApprovalEntry = PendingApproval & ApprovalPayload;

/**
 * In-memory dapp approval queue for connection, watch-asset, and invoke prompts.
 */
export type ApprovalQueue = {
  readonly approve: (id: string) => PendingApproval | null;
  readonly deny: (id: string) => PendingApproval | null;
  readonly get: (id: string) => PendingApproval | null;
  readonly list: () => readonly PendingApproval[];
  readonly payload: (id: string) => ApprovalPayload | null;
  readonly request: (origin: string) => PendingApproval;
  readonly requestInvoke: (input: {
    readonly calls: readonly Call[];
    readonly flags: readonly ApprovalRiskFlag[];
    readonly origin: string;
    readonly summaries: readonly string[];
  }) => PendingApproval;
  readonly requestSignTypedData: (input: {
    readonly origin: string;
    readonly summary: string;
    readonly typedData: unknown;
  }) => PendingApproval;
  readonly requestWatchAsset: (input: {
    readonly origin: string;
    readonly token: WatchAssetToken;
  }) => PendingApproval;
};

const cloneCall = (call: Call): Call =>
  Array.isArray(call.calldata) ? { ...call, calldata: [...call.calldata] } : { ...call };

const approvalSnapshot = (approval: ApprovalEntry): PendingApproval => ({
  id: approval.id,
  kind: approval.kind,
  origin: approval.origin,
  ...(approval.token === undefined ? {} : { token: { ...approval.token } }),
  ...(approval.summaries === undefined ? {} : { summaries: [...approval.summaries] }),
  ...(approval.flags === undefined ? {} : { flags: approval.flags.map((flag) => ({ ...flag })) }),
});

/**
 * Creates a deduplicating approval queue. Connection prompts dedupe per origin;
 * watch-asset prompts dedupe per origin and token address so different tokens
 * from the same site queue independently. Invoke prompts never dedupe — each
 * transaction is a distinct action that must be approved on its own.
 */
export const createApprovalQueue = (): ApprovalQueue => {
  const pending = new Map<string, ApprovalEntry>();

  const entry = (id: string): ApprovalEntry | null => {
    if (!isUuid(id)) {
      return null;
    }
    return pending.get(id) ?? null;
  };

  const get = (id: string): PendingApproval | null => {
    const approval = entry(id);
    return approval ? approvalSnapshot(approval) : null;
  };

  const remove = (id: string): PendingApproval | null => {
    const approval = get(id);
    pending.delete(id);
    return approval;
  };

  const enqueue = (approval: ApprovalEntry): PendingApproval => {
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
    payload(id) {
      const approval = entry(id);
      if (!approval) {
        return null;
      }
      if (approval.typedData !== undefined) {
        return { typedData: approval.typedData };
      }
      if (approval.calls === undefined) {
        return null;
      }
      return { calls: approval.calls.map(cloneCall) };
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
    requestInvoke({ calls, flags, origin, summaries }) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      return enqueue({
        calls: calls.map(cloneCall),
        flags: flags.map((flag) => ({ ...flag })),
        id: crypto.randomUUID(),
        kind: "invoke",
        origin,
        summaries: [...summaries],
      });
    },
    requestSignTypedData({ origin, summary, typedData }) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      return enqueue({
        id: crypto.randomUUID(),
        kind: "sign-typed-data",
        origin,
        summaries: [summary],
        typedData,
      });
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
