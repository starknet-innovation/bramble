/**
 * Runtime router context: the fully wired collaborator bundle every background
 * message handler receives, and the named options callers use to override any
 * part of it. Kept beside the router rather than inside it so `messages.ts`
 * stays a dispatch table.
 */

import { type MultisigStore, memoryMultisigStore } from "@mc-wallet/multisig/repository";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@mc-wallet/permissions/blocklist";
import {
  memoryOriginHistory,
  type OriginHistoryStore,
} from "@mc-wallet/permissions/origin-history";
import { type PriceService, unavailablePriceService } from "@mc-wallet/portfolio/prices";
import type { WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import { type ActivityLog, memoryActivityLog, systemClock } from "@mc-wallet/transactions/activity";
import { type AllowanceStore, memoryAllowanceStore } from "@mc-wallet/transactions/allowance-store";
import { type SwapService, unavailableSwapService } from "@mc-wallet/transactions/avnu";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import { type ApprovalQueue, createApprovalQueue } from "../approvals/approvals";
import {
  createSignatureWaiters,
  releaseWaitersOnApprovalDrop,
  type SignatureWaiters,
} from "../approvals/signature-waiters";
import {
  createLedgerSignQueue,
  type LedgerSignQueue,
  type LedgerSignQueueTimeout,
} from "../ledger/ledger-sign-queue";
import {
  type ArgentMultisigDeploymentReviews,
  createArgentMultisigDeploymentReviews,
} from "../multisig/multisig-deployment-reviews";
import {
  createStrk20WalletPreparationStore,
  type Strk20WalletPreparationStore,
} from "../privacy/strk20-wallet-preparations";
import { createWatchAssetAdmission, type WatchAssetAdmission } from "../provider/watch-asset";
import { defaultRuntimeRpc, type RuntimeRpc } from "../runtime/runtime-rpc";
import {
  type ActiveStateCoordinator,
  createActiveStateCoordinator,
  unavailablePreferencesStore,
} from "../runtime/runtime-state";
import type { UnlockSession } from "../runtime/session";
import {
  createSwapPreparationStore,
  type SwapPreparationStore,
} from "../transactions/swap-preparations";

/**
 * Everything the runtime router hands to a sub-handler.
 */
export type RouterContext = {
  readonly activeStateCoordinator: ActiveStateCoordinator;
  readonly activity: ActivityLog;
  readonly allowanceStore: AllowanceStore;
  readonly approvals: ApprovalQueue;
  readonly extensionId: string;
  readonly guard: OriginGuard;
  readonly ledgerSignQueue: LedgerSignQueue;
  readonly multisigDeploymentReviews: ArgentMultisigDeploymentReviews;
  readonly multisigStore: MultisigStore;
  readonly now: () => number;
  readonly originHistory: OriginHistoryStore;
  readonly preferencesStore: WalletPreferencesStore;
  readonly prices: PriceService;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly swap: SwapService;
  readonly swapPreparations: SwapPreparationStore;
  readonly strk20Preparations: Strk20WalletPreparationStore;
  readonly waiters: SignatureWaiters;
  readonly wallet: WalletStatusReader;
  readonly watchAssetAdmission: WatchAssetAdmission;
};

/**
 * Named optional collaborators for {@link createMessageHandler}.
 */
export type MessageHandlerOptions = {
  readonly activeStateCoordinator?: ActiveStateCoordinator;
  readonly activity?: ActivityLog;
  readonly allowanceStore?: AllowanceStore;
  readonly approvals?: ApprovalQueue;
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly multisigDeploymentReviews?: ArgentMultisigDeploymentReviews;
  readonly multisigStore?: MultisigStore;
  /**
   * Wall-clock reader used to age transaction observation windows. Injected so
   * reconciliation is deterministic under test; defaults to the system clock.
   */
  readonly now?: () => number;
  readonly originGuard?: OriginGuard;
  readonly originHistory?: OriginHistoryStore;
  readonly preferencesStore?: WalletPreferencesStore;
  readonly prices?: PriceService;
  readonly runtimeRpc?: RuntimeRpc;
  readonly session?: UnlockSession;
  readonly swap?: SwapService;
  readonly swapPreparations?: SwapPreparationStore;
  readonly strk20Preparations?: Strk20WalletPreparationStore;
  readonly watchAssetAdmission?: WatchAssetAdmission;
};

// Abandon a parked sign after a generous timeout interval.
const LEDGER_SIGN_TIMEOUT: LedgerSignQueueTimeout = {
  ms: 300_000,
  schedule: (onElapsed, ms) => {
    const handle = setTimeout(onElapsed, ms);
    return () => clearTimeout(handle);
  },
};

const runtimeLedgerSignQueue = (
  provided: LedgerSignQueue | undefined,
  session: UnlockSession,
): LedgerSignQueue =>
  provided ??
  createLedgerSignQueue(notifyApprovalsChanged, LEDGER_SIGN_TIMEOUT, () =>
    session.isUnlocked() ? session.generation() : null,
  );

const strk20PreparationsFor = (
  provided: Strk20WalletPreparationStore | undefined,
): Strk20WalletPreparationStore => provided ?? createStrk20WalletPreparationStore();

const activeStateCoordinatorFor = (
  provided: ActiveStateCoordinator | undefined,
): ActiveStateCoordinator => provided ?? createActiveStateCoordinator();

const multisigDeploymentReviewsFor = (
  provided: ArgentMultisigDeploymentReviews | undefined,
): ArgentMultisigDeploymentReviews => provided ?? createArgentMultisigDeploymentReviews();

const watchAssetAdmissionFor = (provided: WatchAssetAdmission | undefined): WatchAssetAdmission =>
  provided ?? createWatchAssetAdmission();

/**
 * Resolves every optional collaborator into the fully wired router context.
 * Absent collaborators fall back to in-memory or explicitly-unavailable
 * defaults, never to a silently permissive one.
 *
 * The approval queue and the waiter registry are bound together here: an
 * approval swept by the queue's TTL frees an admission slot, so the dapp
 * response parked behind it must be released in the same step, or the
 * unbounded growth the caps exist to prevent simply moves into the registry.
 * The binding is applied to a caller-supplied queue too, so the entrypoint's
 * own queue is never left unbound.
 */
export const routerContext = (
  wallet: WalletStatusReader,
  extensionId: string,
  options: MessageHandlerOptions,
  session: UnlockSession,
): RouterContext => {
  const approvals = options.approvals ?? createApprovalQueue();
  const waiters = createSignatureWaiters();
  releaseWaitersOnApprovalDrop(approvals, waiters, notifyApprovalsChanged);
  return {
    activeStateCoordinator: activeStateCoordinatorFor(options.activeStateCoordinator),
    activity: options.activity ?? memoryActivityLog(),
    allowanceStore: options.allowanceStore ?? memoryAllowanceStore(),
    approvals,
    extensionId,
    guard: options.originGuard ?? DEFAULT_ORIGIN_GUARD,
    ledgerSignQueue: runtimeLedgerSignQueue(options.ledgerSignQueue, session),
    multisigDeploymentReviews: multisigDeploymentReviewsFor(options.multisigDeploymentReviews),
    multisigStore: options.multisigStore ?? memoryMultisigStore(),
    now: options.now ?? systemClock,
    originHistory: options.originHistory ?? memoryOriginHistory(),
    preferencesStore: options.preferencesStore ?? unavailablePreferencesStore,
    prices: options.prices ?? unavailablePriceService,
    runtimeRpc: options.runtimeRpc ?? defaultRuntimeRpc,
    session,
    swap: options.swap ?? unavailableSwapService,
    swapPreparations: options.swapPreparations ?? createSwapPreparationStore(),
    strk20Preparations: strk20PreparationsFor(options.strk20Preparations),
    waiters,
    wallet,
    watchAssetAdmission: watchAssetAdmissionFor(options.watchAssetAdmission),
  };
};
