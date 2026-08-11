/**
 * Background-only dapp approval queue. Requests are intentionally not persisted.
 * Admission is bounded globally and per origin, and unanswered prompts expire,
 * so an untrusted page cannot hold the wallet's consent surface hostage — see
 * `./approval-limits` for those rules and `./approval-snapshot` for what a
 * queued approval is allowed to show its readers.
 */

import { systemClock } from "@mc-wallet/transactions/activity";
import { WalletError } from "@mc-wallet/core/errors";
import { isUuid } from "@mc-wallet/core/ids";
import { isWalletOrigin } from "@mc-wallet/core/origin";
import type { StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import type { ProviderChain } from "@mc-wallet/wallet-protocol/add-chain";
import type { ProviderDeclare } from "@mc-wallet/wallet-protocol/declare";
import type { Strk20Action, Strk20Proof } from "@mc-wallet/wallet-protocol/strk20";
import type { Call } from "starknet";
import type { Strk20SubmissionPlan } from "@mc-wallet/privacy/service";

import type { ApprovalContext } from "./approval-context";
import type { InvokeFeeRevision } from "./approval-limits";
import { approvalAdmissionRefusal, isExpiredApproval } from "./approval-limits";
import {
  type ApprovalPayload,
  cloneApprovalCall,
  cloneApprovalValue,
  readStoredApprovalPayload,
} from "./approval-payload";
import {
  type ApprovalRequest,
  type ApprovalRiskFlag,
  approvalSnapshot,
  type DeclarationReview,
  type InvokeFeeReview,
  type PendingApproval,
  type WatchAssetToken,
} from "./approval-snapshot";
import {
  matchesStrk20DisclosureKind,
  type Strk20DisclosureApprovalKind,
  type Strk20DisclosureRequest,
} from "../privacy/strk20-approval-types";

/**
 * Queue admission caps and the abandoned-approval TTL. Re-exported here so the
 * queue's limits stay one definition shared by callers and tests; the rest of
 * `./approval-limits` is imported from there directly.
 */
export {
  APPROVAL_TTL_MS,
  MAX_PENDING_APPROVALS,
  MAX_PENDING_APPROVALS_PER_ORIGIN,
} from "./approval-limits";

/**
 * Public approval discriminants and private payload shape used by background
 * executors. Their definitions live with the total payload-reader map.
 */
export type { ApprovalKind, ApprovalPayload } from "./approval-payload";

/**
 * Display-only approval snapshot types shared with the approval UI, the dapp
 * bridge, and the executors. Their definitions live with the deep copy producing them.
 */
export type {
  ApprovalRiskFlag,
  DeclarationReview,
  InvokeFeeReview,
  PendingApproval,
  WatchAssetToken,
} from "./approval-snapshot";

type ApprovalEntry = ApprovalRequest & { readonly feeRevision: number; readonly queuedAt: number };

/**
 * Observer invoked with the approval ids one TTL sweep dropped. Expiry frees an
 * admission slot, so whatever holds state keyed by an approval id — above all
 * the waiter registry holding the dapp's parked response — must release it here,
 * otherwise the queue stops bounding that state. It runs after the entries are
 * already removed, so the queue is consistent when called; an observer that
 * throws propagates out of the read that triggered the sweep, never swallowed.
 */
export type ApprovalExpiryObserver = (ids: readonly string[]) => void;

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
  /**
   * Claims the fee slot of a queued invoke approval, invalidating every claim
   * outstanding on it; null unless the id is a queued invoke.
   */
  readonly beginInvokeFeeEstimate: (id: string) => InvokeFeeRevision | null;
  /**
   * The refusal one more approval for `origin` would fail with, or null when
   * there is room. A probe; dapp surfaces apply `requireApprovalAdmission`.
   */
  readonly canAdmit: (origin: string) => string | null;
  readonly claim: (id: string) => ApprovalClaim | null;
  readonly deny: (id: string) => PendingApproval | null;
  readonly get: (id: string) => PendingApproval | null;
  readonly list: () => readonly PendingApproval[];
  /**
   * Registers the {@link ApprovalExpiryObserver} for this queue. Exactly one
   * observer is held — a second call replaces the first — because the runtime
   * registers it once while wiring the router context. Registration is the only
   * way expiry becomes visible: the sweep is lazy and fires no event of its own.
   */
  readonly observeExpiry: (observe: ApprovalExpiryObserver) => void;
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
  /**
   * Writes the reviewed fee of the invoke approval `revision` was claimed for.
   * Null — nothing written — once that approval is gone or the claim superseded.
   */
  readonly updateInvokeFee: (
    revision: InvokeFeeRevision,
    fee: InvokeFeeReview,
  ) => PendingApproval | null;
};

/**
 * Construction options for the approval queue.
 */
export type ApprovalQueueOptions = {
  /**
   * Wall-clock reader used to stamp and age queued approvals. Injected so the
   * TTL sweep is deterministic under test; defaults to the system clock, which
   * keeps this module free of a clock boundary of its own.
   */
  readonly now?: () => number;
};

/**
 * Creates a deduplicating approval queue. Connection prompts dedupe per origin;
 * watch-asset prompts dedupe per origin and token address so different tokens
 * from the same site queue independently. Invoke prompts never dedupe — each
 * transaction is a distinct action that must be approved on its own.
 *
 * Admission is bounded twice: globally and per origin (see `./approval-limits`),
 * so one untrusted site cannot fill the queue and deny consent to every other
 * site. Both refusals throw a {@link WalletError}, but a dapp never reads its
 * message: `runtimeErrorResponse` (see `./messages`) reveals an error message
 * only to an extension-page sender, which a content script is not, so the page
 * observes the generic "wallet request failed" (spec UNKNOWN_ERROR). It learns
 * that its request failed, not which cap it hit — the distinct messages are
 * diagnostics for the panel and tests, not a signal a site can probe.
 *
 * Approvals older than the TTL are swept lazily on every read and write — no
 * timer runs in the service worker — and an expired approval reads as absent:
 * it is never listed, claimed, approved, or denied. Because expiry frees an
 * admission slot, the swept ids are reported to the registered
 * {@link ApprovalExpiryObserver} so held dapp responses parked behind them are
 * released too; without that observer the queue would stop bounding the
 * privileged worker's parked-promise heap.
 */
export const createApprovalQueue = (options: ApprovalQueueOptions = {}): ApprovalQueue => {
  const pending = new Map<string, ApprovalEntry>();
  const now = options.now ?? systemClock;
  let expiryObserver: ApprovalExpiryObserver = () => undefined;

  // Drops abandoned prompts so an ignored queue drains itself instead of
  // holding admission slots the user will never spend. Entries are removed
  // before the observer runs so the queue is already consistent when whatever
  // is keyed by those ids is released.
  const sweep = (): void => {
    const at = now();
    const expired: string[] = [];
    for (const [id, approval] of pending) {
      if (isExpiredApproval(approval, at)) {
        expired.push(id);
      }
    }
    if (expired.length === 0) {
      return;
    }
    for (const id of expired) {
      pending.delete(id);
    }
    expiryObserver(expired);
  };

  // Live queue contents with abandoned prompts already dropped. Every read and
  // write goes through this or `entry`, so an expired approval is never listed,
  // matched as a dedupe hit, or counted against an admission cap.
  const queued = (): readonly ApprovalEntry[] => {
    sweep();
    return [...pending.values()];
  };

  const entry = (id: string): ApprovalEntry | null => {
    if (!isUuid(id)) {
      return null;
    }
    sweep();
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

  const enqueue = (approval: ApprovalRequest): PendingApproval => {
    const refusal = approvalAdmissionRefusal(queued(), approval.origin);
    if (refusal) {
      throw new WalletError(refusal);
    }
    pending.set(approval.id, { ...approval, feeRevision: 0, queuedAt: now() });
    return approvalSnapshot(approval);
  };

  return {
    approve: remove,
    beginInvokeFeeEstimate(id) {
      const approval = entry(id);
      if (approval?.kind !== "invoke") {
        return null;
      }
      const revision = approval.feeRevision + 1;
      pending.set(id, { ...approval, feeRevision: revision });
      return { id, revision };
    },
    canAdmit: (origin) => approvalAdmissionRefusal(queued(), origin),
    claim,
    deny: remove,
    get,
    list() {
      return queued().map(approvalSnapshot);
    },
    observeExpiry(observe) {
      expiryObserver = observe;
    },
    payload(id) {
      const approval = entry(id);
      return approval ? readStoredApprovalPayload(approval) : null;
    },
    request(origin) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      const existing = queued().find(
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

      const existing = queued().find(
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

      const existing = queued().find(
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

      const existing = queued().find(
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
    updateInvokeFee({ id, revision }, fee) {
      const approval = entry(id);
      // A superseded claim writes nothing at all, marker included.
      if (approval?.kind !== "invoke" || approval.feeRevision !== revision) {
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
