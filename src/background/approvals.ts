/**
 * Background-only dapp approval queue. Requests are intentionally not persisted.
 */
import type { Call } from "starknet";
import type { ProviderChain } from "../provider/add-chain-params";
import type { ProviderDeclare } from "../provider/declare-params";
import { WalletError } from "../shared/errors";
import { isUuid } from "../shared/ids";
import { isWalletOrigin } from "../shared/origin";
import type { StarknetNetworkId } from "../starknet/networks";
import type { Strk20Action } from "../starknet/strk20/schemas";
import type { ApprovalContext } from "./approval-context";

/**
 * Maximum queued dapp connection approvals kept in background memory.
 */
export const MAX_PENDING_APPROVALS = 50;

/**
 * Approval kinds distinguishing a connection prompt, a watch-asset prompt, and
 * a per-transaction invoke prompt that must be signed off before it executes.
 */
export type ApprovalKind =
  | "add-chain"
  | "connect"
  | "declare"
  | "invoke"
  | "sign-typed-data"
  | "strk20-invoke"
  | "switch-chain"
  | "watch-asset";

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
  readonly context?: ApprovalContext;
  readonly flags?: readonly ApprovalRiskFlag[];
  readonly id: string;
  readonly insights?: readonly string[];
  readonly kind: ApprovalKind;
  readonly origin: string;
  readonly summaries?: readonly string[];
  readonly token?: WatchAssetToken;
  readonly typedData?: unknown;
};

/**
 * Execution payload held privately until approve time. Invoke calls and the
 * switch-chain target never need to cross to the UI in raw form; typed data is
 * mirrored into the snapshot so the sign card can decode and display it.
 */
export type ApprovalPayload = {
  readonly actions?: readonly Strk20Action[];
  readonly calls?: readonly Call[];
  readonly chain?: ProviderChain;
  readonly chainId?: string;
  readonly declare?: ProviderDeclare;
  readonly networkId?: StarknetNetworkId;
  readonly typedData?: unknown;
};

type ApprovalEntry = PendingApproval & ApprovalPayload;

/**
 * Atomically claimed approval snapshot and its private execution payload. Once
 * returned, the id is no longer pending and cannot be claimed a second time.
 */
export type ApprovalClaim = {
  readonly approval: PendingApproval;
  readonly payload: ApprovalPayload | null;
};

/**
 * In-memory dapp approval queue for connection, watch-asset, and invoke prompts.
 */
export type ApprovalQueue = {
  readonly approve: (id: string) => PendingApproval | null;
  readonly claim: (id: string) => ApprovalClaim | null;
  readonly deny: (id: string) => PendingApproval | null;
  readonly get: (id: string) => PendingApproval | null;
  readonly list: () => readonly PendingApproval[];
  readonly payload: (id: string) => ApprovalPayload | null;
  readonly request: (origin: string) => PendingApproval;
  readonly requestAddChain: (input: {
    readonly chain: ProviderChain;
    readonly origin: string;
    readonly summaries: readonly string[];
  }) => PendingApproval;
  readonly requestDeclare: (input: {
    readonly context: ApprovalContext;
    readonly declare: ProviderDeclare;
    readonly origin: string;
    readonly summaries: readonly string[];
  }) => PendingApproval;
  readonly requestInvoke: (input: {
    readonly calls: readonly Call[];
    readonly context: ApprovalContext;
    readonly flags: readonly ApprovalRiskFlag[];
    readonly origin: string;
    readonly summaries: readonly string[];
  }) => PendingApproval;
  readonly requestSignTypedData: (input: {
    readonly context: ApprovalContext;
    readonly origin: string;
    readonly summary: string;
    readonly typedData: unknown;
  }) => PendingApproval;
  readonly requestStrk20Invoke: (input: {
    readonly actions: readonly Strk20Action[];
    readonly calls: readonly Call[];
    readonly context: ApprovalContext;
    readonly origin: string;
    readonly summaries: readonly string[];
  }) => PendingApproval;
  readonly requestSwitchChain: (input: {
    readonly chainId: string;
    readonly networkId: StarknetNetworkId;
    readonly origin: string;
    readonly summary: string;
  }) => PendingApproval;
  readonly requestWatchAsset: (input: {
    readonly origin: string;
    readonly token: WatchAssetToken;
  }) => PendingApproval;
};

const cloneCall = (call: Call): Call =>
  Array.isArray(call.calldata) ? { ...call, calldata: [...call.calldata] } : { ...call };

const cloneValue = <T>(value: T): T => structuredClone(value);

const readSwitchPayload = (approval: ApprovalEntry): ApprovalPayload | null => {
  if (approval.chainId === undefined || approval.networkId === undefined) {
    return null;
  }
  return { chainId: approval.chainId, networkId: approval.networkId };
};

const readStrk20Payload = (approval: ApprovalEntry): ApprovalPayload | null => {
  if (approval.actions === undefined || approval.calls === undefined) {
    return null;
  }
  return {
    actions: cloneValue(approval.actions),
    calls: approval.calls.map(cloneCall),
  };
};

/**
 * Reconstructs the execution payload held on an entry, discriminating on which
 * private field is set. Typed data, a switch-chain target, a new chain, a
 * declare, and strk20 actions each map to their own payload shape; a plain
 * invoke falls through to its cloned calls. Returns null when no payload was
 * stored (a connection prompt, or an invoke with no calls).
 */
const readApprovalPayload = (approval: ApprovalEntry): ApprovalPayload | null => {
  switch (approval.kind) {
    case "sign-typed-data":
      return approval.typedData === undefined
        ? null
        : { typedData: cloneValue(approval.typedData) };
    case "switch-chain":
      return readSwitchPayload(approval);
    case "add-chain":
      return approval.chain === undefined ? null : { chain: cloneValue(approval.chain) };
    case "declare":
      return approval.declare === undefined ? null : { declare: cloneValue(approval.declare) };
    case "strk20-invoke":
      return readStrk20Payload(approval);
    case "invoke":
      return approval.calls === undefined ? null : { calls: approval.calls.map(cloneCall) };
    default:
      return null;
  }
};

const approvalSnapshot = (approval: ApprovalEntry): PendingApproval => ({
  ...(approval.context === undefined ? {} : { context: { ...approval.context } }),
  id: approval.id,
  kind: approval.kind,
  origin: approval.origin,
  ...(approval.token === undefined ? {} : { token: { ...approval.token } }),
  ...(approval.summaries === undefined ? {} : { summaries: [...approval.summaries] }),
  ...(approval.flags === undefined ? {} : { flags: approval.flags.map((flag) => ({ ...flag })) }),
  ...(approval.typedData === undefined ? {} : { typedData: cloneValue(approval.typedData) }),
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

  const claim = (id: string): ApprovalClaim | null => {
    const approval = entry(id);
    if (!approval) {
      return null;
    }
    pending.delete(id);
    return {
      approval: approvalSnapshot(approval),
      payload: readApprovalPayload(approval),
    };
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
    claim,
    deny: remove,
    get,
    list() {
      return [...pending.values()].map(approvalSnapshot);
    },
    payload(id) {
      const approval = entry(id);
      return approval ? readApprovalPayload(approval) : null;
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
    requestAddChain({ chain, origin, summaries }) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      const existing = [...pending.values()].find(
        (approval) =>
          approval.kind === "add-chain" &&
          approval.origin === origin &&
          approval.chain?.chainId === chain.chainId,
      );
      if (existing) {
        return approvalSnapshot(existing);
      }
      return enqueue({
        chain,
        id: crypto.randomUUID(),
        kind: "add-chain",
        origin,
        summaries: [...summaries],
      });
    },
    requestDeclare({ context, declare, origin, summaries }) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      return enqueue({
        context: { ...context },
        declare: cloneValue(declare),
        id: crypto.randomUUID(),
        kind: "declare",
        origin,
        summaries: [...summaries],
      });
    },
    requestInvoke({ calls, context, flags, origin, summaries }) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      return enqueue({
        calls: calls.map(cloneCall),
        context: { ...context },
        flags: flags.map((flag) => ({ ...flag })),
        id: crypto.randomUUID(),
        kind: "invoke",
        origin,
        summaries: [...summaries],
      });
    },
    requestSignTypedData({ context, origin, summary, typedData }) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      return enqueue({
        context: { ...context },
        id: crypto.randomUUID(),
        kind: "sign-typed-data",
        origin,
        summaries: [summary],
        typedData: cloneValue(typedData),
      });
    },
    requestStrk20Invoke({ actions, calls, context, origin, summaries }) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      return enqueue({
        actions: cloneValue(actions),
        calls: calls.map(cloneCall),
        context: { ...context },
        id: crypto.randomUUID(),
        kind: "strk20-invoke",
        origin,
        summaries: [...summaries],
      });
    },
    requestSwitchChain({ chainId, networkId, origin, summary }) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      const existing = [...pending.values()].find(
        (approval) =>
          approval.kind === "switch-chain" &&
          approval.origin === origin &&
          approval.chainId === chainId,
      );
      if (existing) {
        return approvalSnapshot(existing);
      }
      return enqueue({
        chainId,
        id: crypto.randomUUID(),
        kind: "switch-chain",
        networkId,
        origin,
        summaries: [summary],
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
