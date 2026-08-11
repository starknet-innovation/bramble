/**
 * Background-only dapp approval queue. Requests are intentionally not persisted.
 */

import { WalletError } from "@mc-wallet/core/errors";
import { isUuid } from "@mc-wallet/core/ids";
import { isWalletOrigin } from "@mc-wallet/core/origin";
import type { StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import type { ProviderChain } from "@mc-wallet/wallet-protocol/add-chain";
import type { ProviderDeclare } from "@mc-wallet/wallet-protocol/declare";
import type {
  Strk20Action,
  Strk20Proof,
  Strk20WithdrawAction,
} from "@mc-wallet/wallet-protocol/strk20";
import type { Call } from "starknet";
import type { DeclareFeeEstimate } from "@mc-wallet/starknet/declare";
import type { FeeAffordability } from "@mc-wallet/transactions/fee-funds";
import type { FeeEstimate } from "@mc-wallet/starknet/rpc";
import type { Strk20SubmissionPlan } from "@mc-wallet/privacy/service";
import type { ApprovalContext } from "./approval-context";
import {
  type ApprovalKind,
  type ApprovalPayload,
  cloneApprovalCall,
  cloneApprovalValue,
  readStoredApprovalPayload,
} from "./approval-payload";
import {
  matchesStrk20DisclosureKind,
  type Strk20DisclosureApprovalKind,
  type Strk20DisclosureRequest,
} from "../privacy/strk20-approval-types";

/**
 * Maximum queued dapp connection approvals kept in background memory.
 */
export const MAX_PENDING_APPROVALS = 50;

/**
 * Public approval discriminants and private payload shape used by background
 * executors. Their definitions live with the total payload-reader map.
 */
export type { ApprovalKind, ApprovalPayload } from "./approval-payload";

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
 * Safe, display-only facts derived from a private Cairo declaration payload.
 * The contract class itself never crosses to the approval UI.
 */
export type DeclarationReview = {
  readonly abiEntryCount: number;
  readonly accountDeployment: "deployed" | "undeployed" | "unknown";
  readonly classHash?: string;
  readonly compiledClassHash: string;
  readonly deploymentFee: DeclareFeeEstimate | null;
  readonly deploymentFeeEstimateFailed: boolean;
  readonly entryPointCount: number;
  readonly fee: DeclareFeeEstimate | null;
  readonly feeEstimateFailed: boolean;
  readonly sierraProgramLength: number;
};

/**
 * Display-only invoke fee state, aligned with Send review classification.
 */
export type InvokeFeeReview = {
  readonly fee: FeeEstimate | null;
  readonly feeAffordability: FeeAffordability;
  readonly feeEstimateFailed: boolean;
  readonly feeEstimatePending: boolean;
  readonly requiresDeployment: boolean;
};

/**
 * Pending dapp approval snapshot. Kind-specific review fields are display-only;
 * reputation fields are attached when listed and are not queue state.
 */
export type PendingApproval = {
  readonly actionReviews?: readonly Strk20Action[];
  readonly blocked?: boolean;
  readonly context?: ApprovalContext;
  readonly declaration?: DeclarationReview;
  readonly fee?: FeeEstimate | null;
  readonly feeAffordability?: FeeAffordability;
  readonly feeEstimateFailed?: boolean;
  readonly feeEstimatePending?: boolean;
  readonly flags?: readonly ApprovalRiskFlag[];
  readonly id: string;
  readonly insights?: readonly string[];
  readonly kind: ApprovalKind;
  readonly origin: string;
  readonly relayFeeAction?: Strk20WithdrawAction;
  readonly requiresDeployment?: boolean;
  readonly summaries?: readonly string[];
  readonly token?: WatchAssetToken;
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
    readonly declaration: DeclarationReview;
    readonly origin: string;
    readonly summaries: readonly string[];
  }) => PendingApproval;
  readonly requestInvoke: (input: {
    readonly calls: readonly Call[];
    readonly context: ApprovalContext;
    readonly fee: InvokeFeeReview;
    readonly flags: readonly ApprovalRiskFlag[];
    readonly origin: string;
    readonly proof?: Strk20Proof;
    readonly summaries: readonly string[];
  }) => PendingApproval;
  readonly requestSignTypedData: (input: {
    readonly context: ApprovalContext;
    readonly origin: string;
    readonly summary: string;
    readonly typedData: unknown;
  }) => PendingApproval;
  readonly requestStrk20Disclosure: (input: {
    readonly context: ApprovalContext;
    readonly kind: Strk20DisclosureApprovalKind;
    readonly origin: string;
    readonly request: Strk20DisclosureRequest;
    readonly summaries: readonly string[];
  }) => PendingApproval;
  readonly requestStrk20Invoke: (input: {
    readonly actions: readonly Strk20Action[];
    readonly context: ApprovalContext;
    readonly origin: string;
    readonly plan: Strk20SubmissionPlan;
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
  readonly updateInvokeFee: (id: string, fee: InvokeFeeReview) => PendingApproval | null;
};

// Copies an invoke entry's fee review onto its snapshot without materializing
// absent fields, so non-invoke snapshots stay byte-identical to before.
const feeReviewSnapshot = (approval: ApprovalEntry): Partial<PendingApproval> => ({
  ...(approval.fee === undefined ? {} : { fee: approval.fee && { ...approval.fee } }),
  ...(approval.feeAffordability === undefined
    ? {}
    : { feeAffordability: approval.feeAffordability }),
  ...(approval.feeEstimateFailed === undefined
    ? {}
    : { feeEstimateFailed: approval.feeEstimateFailed }),
  ...(approval.feeEstimatePending === undefined
    ? {}
    : { feeEstimatePending: approval.feeEstimatePending }),
  ...(approval.requiresDeployment === undefined
    ? {}
    : { requiresDeployment: approval.requiresDeployment }),
});

const approvalSnapshot = (approval: ApprovalEntry): PendingApproval => ({
  ...(approval.actionReviews === undefined
    ? {}
    : { actionReviews: cloneApprovalValue(approval.actionReviews) }),
  ...(approval.context === undefined ? {} : { context: { ...approval.context } }),
  ...feeReviewSnapshot(approval),
  ...(approval.declaration === undefined
    ? {}
    : {
        declaration: {
          ...approval.declaration,
          deploymentFee: approval.declaration.deploymentFee && {
            ...approval.declaration.deploymentFee,
          },
          fee: approval.declaration.fee && { ...approval.declaration.fee },
        },
      }),
  id: approval.id,
  kind: approval.kind,
  origin: approval.origin,
  ...(approval.relayFeeAction === undefined
    ? {}
    : { relayFeeAction: cloneApprovalValue(approval.relayFeeAction) }),
  ...(approval.token === undefined ? {} : { token: { ...approval.token } }),
  ...(approval.summaries === undefined ? {} : { summaries: [...approval.summaries] }),
  ...(approval.flags === undefined ? {} : { flags: approval.flags.map((flag) => ({ ...flag })) }),
  ...(approval.typedData === undefined
    ? {}
    : { typedData: cloneApprovalValue(approval.typedData) }),
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
      payload: readStoredApprovalPayload(approval),
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
      return approval ? readStoredApprovalPayload(approval) : null;
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
    requestDeclare({ context, declaration, declare, origin, summaries }) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      return enqueue({
        context: { ...context },
        declaration: {
          ...declaration,
          deploymentFee: declaration.deploymentFee && { ...declaration.deploymentFee },
          fee: declaration.fee && { ...declaration.fee },
        },
        declare: cloneApprovalValue(declare),
        id: crypto.randomUUID(),
        kind: "declare",
        origin,
        summaries: [...summaries],
      });
    },
    requestInvoke({ calls, context, fee, flags, origin, proof, summaries }) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      return enqueue({
        calls: calls.map(cloneApprovalCall),
        context: { ...context },
        fee: fee.fee && { ...fee.fee },
        feeAffordability: fee.feeAffordability,
        feeEstimateFailed: fee.feeEstimateFailed,
        feeEstimatePending: fee.feeEstimatePending,
        flags: flags.map((flag) => ({ ...flag })),
        id: crypto.randomUUID(),
        kind: "invoke",
        origin,
        ...(proof === undefined ? {} : { proof: cloneApprovalValue(proof) }),
        requiresDeployment: fee.requiresDeployment,
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
        typedData: cloneApprovalValue(typedData),
      });
    },
    requestStrk20Disclosure({ context, kind, origin, request, summaries }) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }
      if (!matchesStrk20DisclosureKind(kind, request)) {
        throw new WalletError("Invalid STRK20 approval");
      }
      return enqueue({
        ...(request.type === "prepare"
          ? { actionReviews: cloneApprovalValue(request.actions) }
          : {}),
        context: { ...context },
        id: crypto.randomUUID(),
        kind,
        origin,
        strk20Request: cloneApprovalValue(request),
        summaries: [...summaries],
      });
    },
    requestStrk20Invoke({ actions, context, origin, plan, summaries }) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      return enqueue({
        actionReviews: cloneApprovalValue(actions),
        actions: cloneApprovalValue(actions),
        context: { ...context },
        id: crypto.randomUUID(),
        kind: "strk20-invoke",
        origin,
        ...("feeAction" in plan ? { relayFeeAction: cloneApprovalValue(plan.feeAction) } : {}),
        strk20Plan: cloneApprovalValue(plan),
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
    updateInvokeFee(id, fee) {
      const approval = entry(id);
      if (approval?.kind !== "invoke") {
        return null;
      }
      pending.set(id, {
        ...approval,
        fee: fee.fee && { ...fee.fee },
        feeAffordability: fee.feeAffordability,
        feeEstimateFailed: fee.feeEstimateFailed,
        feeEstimatePending: fee.feeEstimatePending,
        requiresDeployment: fee.requiresDeployment,
      });
      return get(id);
    },
  };
};
