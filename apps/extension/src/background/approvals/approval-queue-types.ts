/**
 * The approval queue's public contract: what a caller may claim, request, and
 * update, and how the queue is constructed.
 *
 * Separated from the implementation so the shapes every caller depends on can be
 * read without the queue's internals, and so neither file grows past the size
 * limit as lanes are added.
 */

import type { Strk20SubmissionPlan } from "@mc-wallet/privacy/service";
import type { StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import type { ProviderChain } from "@mc-wallet/wallet-protocol/add-chain";
import type { ProviderDeclare } from "@mc-wallet/wallet-protocol/declare";
import type { Strk20Action, Strk20Proof } from "@mc-wallet/wallet-protocol/strk20";
import type { Call } from "starknet";
import type {
  Strk20DisclosureApprovalKind,
  Strk20DisclosureRequest,
} from "../privacy/strk20-approval-types";
import type { ApprovalContext } from "./approval-context";
import type { ApprovalFeeRevision } from "./approval-limits";
import type { ApprovalPayload } from "./approval-payload";
import type {
  ApprovalRiskFlag,
  DeclarationReview,
  InvokeFeeReview,
  PendingApproval,
  WatchAssetToken,
} from "./approval-snapshot";

/** Notifies a caller which approval ids the TTL sweep dropped. */
export type ApprovalDropObserver = (ids: readonly string[]) => void;

/**
 * Atomically claimed snapshot and private payload. The id cannot be reclaimed.
 */
export type ApprovalClaim = {
  readonly approval: PendingApproval;
  readonly payload: ApprovalPayload | null;
};
/**
 * In-memory dapp approval queue; all claim and admission failures are explicit.
 */
export type ApprovalQueue = {
  /**
   * Claims the fee slot of a queued invoke or declare approval, invalidating
   * every claim outstanding on it.
   */
  readonly beginFeeEstimate: (id: string) => ApprovalFeeRevision | null;
  /**
   * The refusal one more approval for `origin` would fail with, or null when
   * there is room. A probe; dapp surfaces apply `requireApprovalAdmission`.
   */
  readonly canAdmit: (origin: string) => string | null;
  readonly claim: (id: string) => ApprovalClaim | null;
  readonly get: (id: string) => PendingApproval | null;
  readonly list: () => readonly PendingApproval[];
  /**
   * Registers the {@link ApprovalDropObserver} for this queue. Exactly one
   * observer is held — a second call replaces the first — because the runtime
   * registers it once while wiring the router context. Registration is the only
   * way expiry becomes visible: the sweep is lazy and fires no event of its own.
   */
  readonly observeDrops: (observe: ApprovalDropObserver) => void;
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
    readonly reviewAssets?: NonNullable<PendingApproval["reviewAssets"]>;
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
    readonly reviewAssets?: NonNullable<PendingApproval["reviewAssets"]>;
    readonly summaries: readonly string[];
  }) => PendingApproval;
  readonly requestStrk20Invoke: (input: {
    readonly actions: readonly Strk20Action[];
    readonly context: ApprovalContext;
    readonly origin: string;
    readonly plan: Strk20SubmissionPlan;
    readonly reviewAssets?: NonNullable<PendingApproval["reviewAssets"]>;
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
  /** Writes a fee review only while its queue revision remains current. */
  readonly updateFee: (
    revision: ApprovalFeeRevision,
    update:
      | { readonly declaration: DeclarationReview; readonly kind: "declare" }
      | { readonly kind: "invoke"; readonly review: InvokeFeeReview },
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
