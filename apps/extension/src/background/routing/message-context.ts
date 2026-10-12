/**
 * Runtime router context: the fully wired collaborator bundle every background
 * message handler receives, and the named options callers use to override any
 * part of it. Kept beside the router rather than inside it so `messages.ts`
 * stays a dispatch table.
 */

import {
  memoryNostrCoordinationStore,
  type NostrCoordinationStore,
} from "@bramble/multisig/coordination";
import { type MultisigStore, memoryMultisigStore } from "@bramble/multisig/repository";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@bramble/permissions/blocklist";
import { memoryOriginHistory, type OriginHistoryStore } from "@bramble/permissions/origin-history";
import { type PriceService, unavailablePriceService } from "@bramble/portfolio/prices";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { type ActivityLog, memoryActivityLog, systemClock } from "@bramble/transactions/activity";
import { type AllowanceStore, memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import { type SwapService, unavailableSwapService } from "@bramble/transactions/avnu";
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
import type { NostrRelayTransport } from "../multisig/nostr-relay";
import {
  createRecoveryDiscoveryCache,
  type RecoveryDiscoveryCache,
} from "../onboarding/recovery-cache";
import {
  type BalanceSnapshotStore,
  memoryBalanceSnapshotStore,
} from "../portfolio/balance-snapshots";
import type { NftSnapshotStore } from "../portfolio/nft-snapshots";
import {
  createStrk20JobRegistry,
  type Strk20JobRegistry,
} from "../privacy/strk20-preparation-jobs";
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
import type { ExtensionIdentity } from "./senders";

/**
 * Everything the runtime router hands to a sub-handler.
 */
export type RouterContext = {
  readonly activeStateCoordinator: ActiveStateCoordinator;
  readonly activity: ActivityLog;
  readonly allowanceStore: AllowanceStore;
  readonly approvals: ApprovalQueue;
  readonly balanceSnapshots: BalanceSnapshotStore;
  readonly extension: ExtensionIdentity;
  readonly guard: OriginGuard;
  readonly ledgerSignQueue: LedgerSignQueue;
  readonly multisigDeploymentReviews: ArgentMultisigDeploymentReviews;
  readonly multisigStore: MultisigStore;
  readonly nostrCoordinationStore: NostrCoordinationStore;
  readonly nftSnapshots?: NftSnapshotStore;
  readonly nostrRelayTransport?: NostrRelayTransport;
  readonly now: () => number;
  readonly originHistory: OriginHistoryStore;
  readonly preferencesStore: WalletPreferencesStore;
  readonly prices: PriceService;
  readonly recoveryDiscovery: RecoveryDiscoveryCache;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly swap: SwapService;
  readonly swapPreparations: SwapPreparationStore;
  readonly strk20Jobs: Strk20JobRegistry;
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
  readonly balanceSnapshots?: BalanceSnapshotStore;
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly multisigDeploymentReviews?: ArgentMultisigDeploymentReviews;
  readonly multisigStore?: MultisigStore;
  readonly nostrCoordinationStore?: NostrCoordinationStore;
  readonly nftSnapshots?: NftSnapshotStore;
  readonly nostrRelayTransport?: NostrRelayTransport;
  /**
   * Wall-clock reader used to age transaction observation windows. Injected so
   * reconciliation is deterministic under test; defaults to the system clock.
   */
  readonly now?: () => number;
  readonly originGuard?: OriginGuard;
  readonly originHistory?: OriginHistoryStore;
  readonly preferencesStore?: WalletPreferencesStore;
  readonly prices?: PriceService;
  readonly recoveryDiscovery?: RecoveryDiscoveryCache;
  readonly runtimeRpc?: RuntimeRpc;
  readonly session?: UnlockSession;
  readonly swap?: SwapService;
  readonly swapPreparations?: SwapPreparationStore;
  /**
   * Tracked-job registry for proofs that outlive one runtime request. The
   * entrypoint supplies one wired to the worker keepalive; the default keeps
   * jobs but relies on the panel's polls alone to hold the worker open.
   */
  readonly strk20Jobs?: Strk20JobRegistry;
  readonly strk20Preparations?: Strk20WalletPreparationStore;
  /**
   * Held-response registry the router parks deferred sign requests in. The
   * entrypoint supplies the instance its worker keepalive watches; the default
   * keeps one private to this context, which is all a unit test needs.
   */
  readonly waiters?: SignatureWaiters;
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

const strk20JobsFor = (
  provided: Strk20JobRegistry | undefined,
  now: () => number,
): Strk20JobRegistry => provided ?? createStrk20JobRegistry({ now });

const activeStateCoordinatorFor = (
  provided: ActiveStateCoordinator | undefined,
): ActiveStateCoordinator => provided ?? createActiveStateCoordinator();

const multisigDeploymentReviewsFor = (
  provided: ArgentMultisigDeploymentReviews | undefined,
): ArgentMultisigDeploymentReviews => provided ?? createArgentMultisigDeploymentReviews();

const nostrCoordinationStoreFor = (
  provided: NostrCoordinationStore | undefined,
): NostrCoordinationStore => provided ?? memoryNostrCoordinationStore();

const watchAssetAdmissionFor = (provided: WatchAssetAdmission | undefined): WatchAssetAdmission =>
  provided ?? createWatchAssetAdmission();

const balanceSnapshotsFor = (provided: BalanceSnapshotStore | undefined): BalanceSnapshotStore =>
  provided ?? memoryBalanceSnapshotStore();

const nftSnapshotsFor = (
  provided: NftSnapshotStore | undefined,
): Pick<RouterContext, "nftSnapshots"> | Record<string, never> =>
  provided ? { nftSnapshots: provided } : {};

const nostrRelayTransportFor = (
  provided: NostrRelayTransport | undefined,
): Pick<RouterContext, "nostrRelayTransport"> | Record<string, never> =>
  provided ? { nostrRelayTransport: provided } : {};

const recoveryDiscoveryFor = (
  provided: RecoveryDiscoveryCache | undefined,
): RecoveryDiscoveryCache => provided ?? createRecoveryDiscoveryCache();

// Split from the context literal so the router's own cognitive-complexity
// budget stays within the gate; a caller-supplied registry (the entrypoint's)
// is watched by that caller's worker keepalive, so the default is only for
// tests that do not wire one.
const waitersFor = (provided: SignatureWaiters | undefined): SignatureWaiters =>
  provided ?? createSignatureWaiters();

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
  extension: ExtensionIdentity,
  options: MessageHandlerOptions,
  session: UnlockSession,
): RouterContext => {
  const approvals = options.approvals ?? createApprovalQueue();
  const waiters = waitersFor(options.waiters);
  const now = options.now ?? systemClock;
  releaseWaitersOnApprovalDrop(approvals, waiters, notifyApprovalsChanged);
  return {
    activeStateCoordinator: activeStateCoordinatorFor(options.activeStateCoordinator),
    activity: options.activity ?? memoryActivityLog(),
    allowanceStore: options.allowanceStore ?? memoryAllowanceStore(),
    approvals,
    balanceSnapshots: balanceSnapshotsFor(options.balanceSnapshots),
    extension,
    guard: options.originGuard ?? DEFAULT_ORIGIN_GUARD,
    ledgerSignQueue: runtimeLedgerSignQueue(options.ledgerSignQueue, session),
    multisigDeploymentReviews: multisigDeploymentReviewsFor(options.multisigDeploymentReviews),
    multisigStore: options.multisigStore ?? memoryMultisigStore(),
    nostrCoordinationStore: nostrCoordinationStoreFor(options.nostrCoordinationStore),
    ...nftSnapshotsFor(options.nftSnapshots),
    ...nostrRelayTransportFor(options.nostrRelayTransport),
    now,
    originHistory: options.originHistory ?? memoryOriginHistory(),
    preferencesStore: options.preferencesStore ?? unavailablePreferencesStore,
    prices: options.prices ?? unavailablePriceService,
    recoveryDiscovery: recoveryDiscoveryFor(options.recoveryDiscovery),
    runtimeRpc: options.runtimeRpc ?? defaultRuntimeRpc,
    session,
    swap: options.swap ?? unavailableSwapService,
    swapPreparations: options.swapPreparations ?? createSwapPreparationStore(),
    strk20Jobs: strk20JobsFor(options.strk20Jobs, now),
    strk20Preparations: strk20PreparationsFor(options.strk20Preparations),
    waiters,
    wallet,
    watchAssetAdmission: watchAssetAdmissionFor(options.watchAssetAdmission),
  };
};
