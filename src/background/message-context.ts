/**
 * Runtime router context: the fully wired collaborator bundle every background
 * message handler receives, and the named options callers use to override any
 * part of it. Kept beside the router rather than inside it so `messages.ts`
 * stays a dispatch table.
 */
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "../security/blocklist";
import { type SwapService, unavailableSwapService } from "../starknet/avnu";
import { type PriceService, unavailablePriceService } from "../starknet/prices";
import { type ActivityLog, memoryActivityLog, systemClock } from "../storage/activity-store";
import { type AllowanceStore, memoryAllowanceStore } from "../storage/allowance-store";
import { type MultisigStore, memoryMultisigStore } from "../storage/multisig-store";
import { memoryOriginHistory, type OriginHistoryStore } from "../storage/origin-history";
import type { WalletPreferencesStore } from "../storage/preferences-store";
import { notifyApprovalsChanged } from "./approval-notifier";
import { type ApprovalQueue, createApprovalQueue } from "./approvals";
import {
  createLedgerSignQueue,
  type LedgerSignQueue,
  type LedgerSignQueueTimeout,
} from "./ledger-sign-queue";
import { defaultRuntimeRpc, type RuntimeRpc } from "./runtime-rpc";
import {
  type ActiveStateCoordinator,
  createActiveStateCoordinator,
  unavailablePreferencesStore,
} from "./runtime-state";
import type { UnlockSession } from "./session";
import { createSignatureWaiters, type SignatureWaiters } from "./signature-waiters";
import {
  createStrk20WalletPreparationStore,
  type Strk20WalletPreparationStore,
} from "./strk20-wallet-preparations";
import { createSwapPreparationStore, type SwapPreparationStore } from "./swap-preparations";
import type { WalletStatusReader } from "./wallet-reader";

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
  readonly loadMultisigClass: (() => Promise<unknown>) | undefined;
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
  readonly loadMultisigClass?: () => Promise<unknown>;
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

/**
 * Resolves every optional collaborator into the fully wired router context.
 * Absent collaborators fall back to in-memory or explicitly-unavailable
 * defaults, never to a silently permissive one.
 */
export const routerContext = (
  wallet: WalletStatusReader,
  extensionId: string,
  options: MessageHandlerOptions,
  session: UnlockSession,
): RouterContext => ({
  activeStateCoordinator: activeStateCoordinatorFor(options.activeStateCoordinator),
  activity: options.activity ?? memoryActivityLog(),
  allowanceStore: options.allowanceStore ?? memoryAllowanceStore(),
  approvals: options.approvals ?? createApprovalQueue(),
  extensionId,
  guard: options.originGuard ?? DEFAULT_ORIGIN_GUARD,
  ledgerSignQueue: runtimeLedgerSignQueue(options.ledgerSignQueue, session),
  loadMultisigClass: options.loadMultisigClass,
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
  waiters: createSignatureWaiters(),
  wallet,
});
