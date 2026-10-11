/**
 * Background-only dapp approval queue. Requests are intentionally not persisted.
 * Admission is bounded globally and per origin, and unanswered prompts expire,
 * so an untrusted page cannot hold the wallet's consent surface hostage — see
 * `./approval-limits` for those rules and `./approval-snapshot` for what a
 * queued approval is allowed to show its readers.
 */

import { WalletError } from "@bramble/core/errors";
import { isUuid } from "@bramble/core/ids";
import { isWalletOrigin } from "@bramble/core/origin";
import { systemClock } from "@bramble/transactions/activity";
import { matchesStrk20DisclosureKind } from "../privacy/strk20-approval-types";
import {
  approvalAdmissionRefusal,
  approvalCapacityVictim,
  isExpiredApproval,
} from "./approval-limits";
import {
  cloneApprovalCall,
  cloneApprovalValue,
  readStoredApprovalPayload,
} from "./approval-payload";
import {
  type ApprovalRequest,
  approvalSnapshot,
  type InvokeFeeReview,
  type PendingApproval,
} from "./approval-snapshot";

/** Queue admission caps and the abandoned-approval TTL. */
export {
  APPROVAL_TTL_MS,
  MAX_PENDING_APPROVALS,
  MAX_PENDING_APPROVALS_PER_ORIGIN,
} from "./approval-limits";

/**
 * Public approval discriminants and private payload shape used by background executors.
 */
export type { ApprovalKind, ApprovalPayload } from "./approval-payload";

/**
 * Display-only approval snapshot types shared with the UI and executors.
 */
export type {
  ApprovalRiskFlag,
  InvokeFeeReview,
  PendingApproval,
  WatchAssetToken,
} from "./approval-snapshot";

import type {
  ApprovalClaim,
  ApprovalDropObserver,
  ApprovalQueue,
  ApprovalQueueOptions,
} from "./approval-queue-types";

/**
 * The queue contract, re-exported so existing wiring keeps one import site.
 */
export type { ApprovalClaim, ApprovalQueue, ApprovalQueueOptions } from "./approval-queue-types";

type ApprovalEntry = ApprovalRequest & { readonly feeRevision: number; readonly queuedAt: number };

// An invoke entry with a fresh fee review applied. The review replaces the
// deploy-first state rather than inheriting it from the previous one.
const withInvokeFeeReview = (approval: ApprovalEntry, review: InvokeFeeReview): ApprovalEntry => {
  const { deployFirst: _stale, ...current } = approval;
  return {
    ...current,
    ...(review.deployFirst === true ? { deployFirst: true } : {}),
    fee: review.fee && { ...review.fee },
    feeAffordability: review.feeAffordability,
    feeEstimateFailed: review.feeEstimateFailed,
    feeEstimatePending: review.feeEstimatePending,
    requiresDeployment: review.requiresDeployment,
  };
};

const copyReviewAssets = (assets: NonNullable<PendingApproval["reviewAssets"]>) =>
  assets.length === 0 ? {} : { reviewAssets: assets.map((asset) => ({ ...asset })) };

const copyFlags = (flags: NonNullable<PendingApproval["flags"]>) =>
  flags.length === 0 ? {} : { flags: flags.map((flag) => ({ ...flag })) };

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
 * {@link ApprovalDropObserver} so held dapp responses parked behind them are
 * released too; without that observer the queue would stop bounding the
 * privileged worker's parked-promise heap.
 */
export const createApprovalQueue = (options: ApprovalQueueOptions = {}): ApprovalQueue => {
  const pending = new Map<string, ApprovalEntry>();
  const now = options.now ?? systemClock;
  let dropObserver: ApprovalDropObserver = () => undefined;

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
    dropObserver(expired);
  };

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
    const live = queued();
    const refusal = approvalAdmissionRefusal(live, approval.origin);
    if (refusal) {
      throw new WalletError(refusal);
    }
    const victim = approvalCapacityVictim(live);
    if (victim) {
      pending.delete(victim.id);
      dropObserver([victim.id]);
    }
    pending.set(approval.id, { ...approval, feeRevision: 0, queuedAt: now() });
    return approvalSnapshot(approval);
  };

  return {
    beginFeeEstimate(id) {
      const approval = entry(id);
      if (approval?.kind !== "invoke" && approval?.kind !== "declare") {
        return null;
      }
      const revision = approval.feeRevision + 1;
      pending.set(id, { ...approval, feeRevision: revision });
      return { id, revision };
    },
    canAdmit: (origin) => approvalAdmissionRefusal(queued(), origin),
    claim,
    get,
    list() {
      return queued().map(approvalSnapshot);
    },
    observeDrops(observe) {
      dropObserver = observe;
    },
    payload(id) {
      const approval = entry(id);
      return approval ? readStoredApprovalPayload(approval) : null;
    },
    request(origin, options) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      const existing = queued().find(
        (approval) => approval.kind === "connect" && approval.origin === origin,
      );
      if (existing) {
        return approvalSnapshot(existing);
      }
      return enqueue({
        ...(options?.existingGrant === undefined ? {} : { existingGrant: options.existingGrant }),
        id: crypto.randomUUID(),
        kind: "connect",
        origin,
      });
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
    requestInvoke(input) {
      if (!isWalletOrigin(input.origin)) {
        throw new WalletError("Invalid origin");
      }
      return enqueue({
        ...(input.activitySummary === undefined ? {} : { activitySummary: input.activitySummary }),
        calls: input.calls.map(cloneApprovalCall),
        context: { ...input.context },
        ...(input.fee.deployFirst === true ? { deployFirst: true } : {}),
        fee: input.fee.fee && { ...input.fee.fee },
        feeAffordability: input.fee.feeAffordability,
        feeEstimateFailed: input.fee.feeEstimateFailed,
        feeEstimatePending: input.fee.feeEstimatePending,
        flags: input.flags.map((flag) => ({ ...flag })),
        id: crypto.randomUUID(),
        kind: "invoke",
        origin: input.origin,
        ...(input.proof === undefined ? {} : { proof: cloneApprovalValue(input.proof) }),
        ...copyReviewAssets(input.reviewAssets ?? []),
        requiresDeployment: input.fee.requiresDeployment,
        summaries: [...input.summaries],
      });
    },
    requestSignTypedData({ context, origin, review, summary, typedData }) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      return enqueue({
        context: { ...context },
        ...(review ? { flags: review.flags.map((flag) => ({ ...flag })) } : {}),
        id: crypto.randomUUID(),
        kind: "sign-typed-data",
        origin,
        summaries: [summary, ...(review?.summaries ?? [])],
        typedData: cloneApprovalValue(typedData),
      });
    },
    requestStrk20Disclosure({
      context,
      flags = [],
      kind,
      origin,
      request,
      reviewAssets = [],
      summaries,
    }) {
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
        ...copyFlags(flags),
        id: crypto.randomUUID(),
        kind,
        origin,
        ...copyReviewAssets(reviewAssets),
        strk20Request: cloneApprovalValue(request),
        summaries: [...summaries],
      });
    },
    requestStrk20Invoke({
      actions,
      context,
      flags = [],
      origin,
      plan,
      reviewAssets = [],
      summaries,
    }) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      return enqueue({
        actionReviews: cloneApprovalValue(actions),
        actions: cloneApprovalValue(actions),
        context: { ...context },
        ...copyFlags(flags),
        id: crypto.randomUUID(),
        kind: "strk20-invoke",
        origin,
        ...copyReviewAssets(reviewAssets),
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
    updateFee({ id, revision }, update) {
      const approval = entry(id);
      if (!approval || approval.feeRevision !== revision || approval.kind !== update.kind) {
        return null;
      }
      if (approval.kind === "declare" && update.kind === "declare") {
        pending.set(id, {
          ...approval,
          declaration: {
            ...update.declaration,
            deploymentFee: update.declaration.deploymentFee && {
              ...update.declaration.deploymentFee,
            },
            fee: update.declaration.fee && { ...update.declaration.fee },
          },
        });
      } else if (approval.kind === "invoke" && update.kind === "invoke") {
        pending.set(id, withInvokeFeeReview(approval, update.review));
      }
      return get(id);
    },
  };
};
