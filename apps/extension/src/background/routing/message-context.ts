/**
 * Runtime router context: the fully wired collaborator bundle every background
 * message handler receives, and the named options callers use to override any
 * part of it. Kept beside the router rather than inside it so `messages.ts`
 * stays a dispatch table.
 */

import {
  memoryNostrCoordinationStore,
  type NostrCoordinationStore,
} from "@mc-wallet/multisig/coordination";
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
import type { MlDsaDeviceCrypto } from "../devices/device-queues";
import { createMobilePqEnrollment, type MobilePqEnrollment } from "../devices/mobile-pq-enrollment";
import {
  createMobilePqSignQueue,
  type MobilePqSignQueue,
  type MobilePqSignQueueTimeout,
} from "../devices/mobile-pq-signer";
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
  readonly balanceSnapshots: BalanceSnapshotStore;
  readonly extensionId: string;
  readonly guard: OriginGuard;
  readonly ledgerSignQueue: LedgerSignQueue;
  readonly mlDsa?: MlDsaDeviceCrypto;
  readonly mobilePqEnrollment: MobilePqEnrollment;
  readonly mobilePqSignQueue: MobilePqSignQueue;
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
  readonly mlDsa?: MlDsaDeviceCrypto;
  readonly mobilePqEnrollment?: MobilePqEnrollment;
  readonly mobilePqSignQueue?: MobilePqSignQueue;
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
  readonly strk20Preparations?: Strk20WalletPreparationStore;
  readonly watchAssetAdmission?: WatchAssetAdmission;
};

const scheduleSignTimeout = (onElapsed: () => void, ms: number): (() => void) => {
  const handle = setTimeout(onElapsed, ms);
  return () => clearTimeout(handle);
};

// Abandon a parked sign after a generous timeout interval. A Ledger round-trip
// is a button press on a device already plugged in and unlocked.
const LEDGER_SIGN_TIMEOUT: LedgerSignQueueTimeout = {
  ms: 300_000,
  schedule: scheduleSignTimeout,
};

// A phone round-trip is not a button press: notice the prompt, pick up the
// phone, unlock it, open the app, authenticate, confirm. Both this bound and the
// odds of the unlock session expiring mid-signature rise accordingly, so the
// Ledger interval chosen for hardware is too short here. Tune from real device
// timings rather than treating this as settled.
const MOBILE_PQ_SIGN_TIMEOUT: MobilePqSignQueueTimeout = {
  ms: 900_000,
  schedule: scheduleSignTimeout,
};

const liveGeneration = (session: UnlockSession) => (): number | null =>
  session.isUnlocked() ? session.generation() : null;

const runtimeLedgerSignQueue = (
  provided: LedgerSignQueue | undefined,
  session: UnlockSession,
): LedgerSignQueue =>
  provided ??
  createLedgerSignQueue(notifyApprovalsChanged, LEDGER_SIGN_TIMEOUT, liveGeneration(session));

const runtimeMobilePqSignQueue = (
  provided: MobilePqSignQueue | undefined,
  session: UnlockSession,
): MobilePqSignQueue =>
  provided ??
  createMobilePqSignQueue(notifyApprovalsChanged, MOBILE_PQ_SIGN_TIMEOUT, liveGeneration(session));

// Follows the other `...For` helpers here: an absent collaborator becomes an
// absent key, so the result stays assignable under `exactOptionalPropertyTypes`.
const mlDsaFor = (mlDsa: MlDsaDeviceCrypto | undefined): { readonly mlDsa?: MlDsaDeviceCrypto } =>
  mlDsa ? { mlDsa } : {};

const mobilePqEnrollmentFor = (provided: MobilePqEnrollment | undefined): MobilePqEnrollment =>
  provided ?? createMobilePqEnrollment();

const strk20PreparationsFor = (
  provided: Strk20WalletPreparationStore | undefined,
): Strk20WalletPreparationStore => provided ?? createStrk20WalletPreparationStore();

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
    balanceSnapshots: balanceSnapshotsFor(options.balanceSnapshots),
    extensionId,
    guard: options.originGuard ?? DEFAULT_ORIGIN_GUARD,
    ledgerSignQueue: runtimeLedgerSignQueue(options.ledgerSignQueue, session),
    ...mlDsaFor(options.mlDsa),
    mobilePqEnrollment: mobilePqEnrollmentFor(options.mobilePqEnrollment),
    mobilePqSignQueue: runtimeMobilePqSignQueue(options.mobilePqSignQueue, session),
    multisigDeploymentReviews: multisigDeploymentReviewsFor(options.multisigDeploymentReviews),
    multisigStore: options.multisigStore ?? memoryMultisigStore(),
    nostrCoordinationStore: nostrCoordinationStoreFor(options.nostrCoordinationStore),
    ...nftSnapshotsFor(options.nftSnapshots),
    ...nostrRelayTransportFor(options.nostrRelayTransport),
    now: options.now ?? systemClock,
    originHistory: options.originHistory ?? memoryOriginHistory(),
    preferencesStore: options.preferencesStore ?? unavailablePreferencesStore,
    prices: options.prices ?? unavailablePriceService,
    recoveryDiscovery: recoveryDiscoveryFor(options.recoveryDiscovery),
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
