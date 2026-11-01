/**
 * Collaborators for settling a queued approval.
 *
 * Split from `./approval-decisions` so a lane can name this set without
 * importing the dispatcher that calls it.
 */

import type { MultisigStore } from "@bramble/multisig/repository";
import type { OriginGuard } from "@bramble/permissions/blocklist";
import type { OriginHistoryStore } from "@bramble/permissions/origin-history";
import type { PriceService } from "@bramble/portfolio/prices";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import type { ActivityLog } from "@bramble/transactions/activity";
import type { AllowanceStore } from "@bramble/transactions/allowance-store";
import type { RelaySignatureLog } from "@bramble/transactions/relay-signatures";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import type { ActiveStateCoordinator } from "../runtime/runtime-state";
import type { UnlockSession } from "../runtime/session";
import type { ApprovalQueue } from "./approval-queue-types";
import type { SignatureWaiters } from "./signature-waiters";

/**
 * Dependencies for resolving a queued approval into its settled result. These
 * collaborators stay inside the privileged background boundary.
 */
export type ApprovalDecisionDeps = {
  readonly activeStateCoordinator: ActiveStateCoordinator;
  readonly activity: ActivityLog;
  readonly allowanceStore: AllowanceStore;
  readonly approvals: ApprovalQueue;
  readonly guard: OriginGuard;
  readonly ledgerSignQueue?: LedgerSignQueue;
  /** Watched shared accounts, trusted by the execution-time lookalike check (Sherlock 140). */
  readonly multisigStore?: Pick<MultisigStore, "listMultisigs">;
  readonly originHistory: OriginHistoryStore;
  readonly preferencesStore: WalletPreferencesStore;
  /** Fiat prices for a gasless fee the user chose. Absent in narrow test doubles. */
  readonly prices?: PriceService;
  /** Signed OutsideExecution messages for Activity; optional for narrow test stubs. */
  readonly relaySignatures?: RelaySignatureLog;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly waiters: SignatureWaiters;
  readonly wallet: WalletStatusReader;
};
