/**
 * Collaborators shared by wallet, send, allowance, and NFT handlers.
 *
 * Split from `./wallet-ops` so a handler can name this set without importing
 * the dispatcher that calls it.
 */

import type { MultisigStore } from "@bramble/multisig/repository";
import type { PriceService } from "@bramble/portfolio/prices";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import type { ActivityLog } from "@bramble/transactions/activity";
import type { AllowanceStore } from "@bramble/transactions/allowance-store";
import type { RelaySignatureLog } from "@bramble/transactions/relay-signatures";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import type { BalanceSnapshotStore } from "../portfolio/balance-snapshots";
import type { NftSnapshotStore } from "../portfolio/nft-snapshots";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import type { ActiveStateCoordinator } from "../runtime/runtime-state";
import type { UnlockSession } from "../runtime/session";
import type { WalletStatusReader } from "./wallet-reader";

/**
 * Dependencies shared by the wallet, allowance, and NFT operations handlers.
 */
export type WalletOpsDeps = {
  /** Serializes network/account selection writes; production always supplies it. */
  readonly activeStateCoordinator?: ActiveStateCoordinator;
  readonly activity: ActivityLog;
  readonly allowanceStore: AllowanceStore;
  readonly balanceSnapshots?: BalanceSnapshotStore;
  /** Keyless Ledger round-trip queue; a Ledger signing request without one fails closed. */
  readonly ledgerSignQueue?: LedgerSignQueue;
  /**
   * Watched shared-account registry used only to authorize address-scoped,
   * read-only asset discovery. Signing paths resolve multisigs separately.
   */
  readonly multisigStore?: MultisigStore;
  /** Public, last-known ownership snapshots; transfer paths still re-prove live ownership. */
  readonly nftSnapshots?: NftSnapshotStore;
  /**
   * Wall-clock reader used to age transaction observation windows. Injected so
   * reconciliation stays deterministic under test; defaults to the system
   * clock boundary.
   */
  readonly now?: () => number;
  readonly preferencesStore: WalletPreferencesStore;
  /** Fiat prices for the gasless fee ceiling. Absent in narrow test doubles. */
  readonly prices?: PriceService;
  /** Signed OutsideExecution messages Activity lists beside transactions (issue 299). */
  readonly relaySignatures?: RelaySignatureLog;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};
