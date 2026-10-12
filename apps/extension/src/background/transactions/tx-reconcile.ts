/**
 * Chain reconciliation for recorded transactions: reads the current status of
 * every transaction still under observation and writes the result back to the
 * activity log, recording a user notice when one fails after the send journey
 * already advanced.
 *
 * This is the effectful half; every decision it makes comes from the pure
 * policy in `./tx-observation.ts`. It runs both from a `wallet.activity`
 * request (one scope, on demand) and from the background alarms in
 * `./tx-monitor.ts` (every scope, on a cadence), so a transaction keeps being
 * verified after the user closes the side panel.
 */

import type { WalletPreferences, WalletPreferencesStore } from "@bramble/settings/preferences";
import type { TransactionFee, TransactionStatusReport } from "@bramble/starknet/rpc";
import {
  type ActivityEntry,
  type ActivityLog,
  type ActivityOutcome,
  type ActivityScope,
  activityForScope,
} from "@bramble/transactions/activity";
import {
  type HistoryLane,
  mergeActivity,
  withoutPlantedRows,
} from "@bramble/transactions/tx-history";
import { STARKNET_NETWORKS, type StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import {
  expiredObservations,
  isObserved,
  isObservedAt,
  type ObservationTier,
  reconciledOutcome,
  retiredOutcome,
} from "./tx-observation";

/**
 * The subset of the wallet operation dependencies reconciliation needs. It
 * deliberately excludes the unlock session and the vault: reconciling a public
 * transaction hash requires no secret, so it keeps working while locked.
 */
export type ReconcileDeps = {
  readonly activity: ActivityLog;
  /** Read-only slice: reconciliation resolves RPC endpoints, never writes. */
  readonly preferencesStore: Pick<WalletPreferencesStore, "read">;
  readonly runtimeRpc: RuntimeRpc;
};

// Both wallet.activity and chrome.alarms reach this module. Serialize their
// full read-chain-write cycles through one worker-wide queue so neither can
// apply an outcome computed from a snapshot the other has already superseded.
let reconciliationTail: Promise<void> = Promise.resolve();
let pendingReconciliations = 0;
const runReconciliation = <T>(operation: () => Promise<T>): Promise<T> => {
  pendingReconciliations += 1;
  const result = reconciliationTail.then(operation, operation);
  reconciliationTail = result.then(
    () => undefined,
    () => undefined,
  );
  void result.then(
    () => {
      pendingReconciliations -= 1;
    },
    () => {
      pendingReconciliations -= 1;
    },
  );
  return result;
};

const byNetwork = (
  entries: readonly ActivityEntry[],
): ReadonlyMap<StarknetNetworkId, readonly ActivityEntry[]> => {
  const grouped = new Map<StarknetNetworkId, readonly ActivityEntry[]>();
  for (const entry of entries) {
    grouped.set(entry.networkId, [...(grouped.get(entry.networkId) ?? []), entry]);
  }
  return grouped;
};

const scopeKey = (scope: ActivityScope): string => `${scope.networkId} ${scope.accountId}`;

const byScope = (entries: readonly ActivityEntry[]): readonly ActivityScope[] => {
  const scopes = new Map<string, ActivityScope>();
  for (const entry of entries) {
    const scope = { accountId: entry.accountId, networkId: entry.networkId };
    scopes.set(scopeKey(scope), scope);
  }
  return [...scopes.values()];
};

const expiredOutcomes = (
  entries: readonly ActivityEntry[],
  nowMs: number,
): Readonly<Record<string, ActivityOutcome>> =>
  Object.fromEntries(
    expiredObservations(entries, nowMs).map((entry) => [entry.hash, retiredOutcome(entry)]),
  );

// Only an outcome the chain executed has a receipt carrying the fee paid.
const hasReceipt = (outcome: ActivityOutcome): boolean =>
  outcome.status === "accepted" || outcome.status === "reverted";

// Reads the receipt fee, once, for each entry that now has one and no fee yet.
// Only rows this wallet submitted qualify: a receipt's fee is paid by the
// transaction's sender, so on a discovered incoming transfer it is someone
// else's fee. A failed or missing read records nothing and is tried again on a
// later pass while the transaction is still under observation.
const receiptFees = async (
  deps: ReconcileDeps,
  rpcUrls: readonly string[],
  outcomes: readonly (readonly [ActivityEntry, ActivityOutcome])[],
): Promise<Readonly<Record<string, TransactionFee>>> => {
  const hashes = outcomes
    .filter(
      ([entry, outcome]) =>
        entry.origin === "wallet" && entry.feePaid === undefined && hasReceipt(outcome),
    )
    .map(([entry]) => entry.hash);
  const read = deps.runtimeRpc.getTransactionFees;
  if (read === undefined || hashes.length === 0) {
    return {};
  }
  return read({ hashes, rpcUrls }).catch(() => ({}));
};

// Reads one network's transactions. A failed status query contributes nothing,
// so those transactions simply stay under observation rather than being misread
// as gone.
const networkOutcomes = async (
  deps: ReconcileDeps,
  preferences: WalletPreferences,
  networkId: StarknetNetworkId,
  entries: readonly ActivityEntry[],
): Promise<readonly (readonly [string, ActivityOutcome])[]> => {
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[networkId], preferences);
  const reports: Readonly<Record<string, TransactionStatusReport>> = await deps.runtimeRpc
    .getTransactionStatuses({ hashes: entries.map((entry) => entry.hash), rpcUrls })
    .catch(() => ({}));
  const outcomes = entries.flatMap((entry) => {
    const report = reports[entry.hash];
    return report === undefined ? [] : [[entry, reconciledOutcome(entry, report)] as const];
  });
  const fees = await receiptFees(deps, rpcUrls, outcomes);
  return outcomes.map(([entry, outcome]) => {
    const feePaid = fees[entry.hash];
    return [entry.hash, feePaid === undefined ? outcome : { ...outcome, feePaid }] as const;
  });
};

// Reads the chain for the given entries, one query per network. Networks are
// independent endpoints, so their reads overlap rather than adding up their
// round-trips.
const chainOutcomes = async (
  deps: ReconcileDeps,
  entries: readonly ActivityEntry[],
): Promise<Readonly<Record<string, ActivityOutcome>>> => {
  if (entries.length === 0) {
    return {};
  }
  const preferences = await deps.preferencesStore.read();
  const perNetwork = await Promise.all(
    [...byNetwork(entries)].map(([networkId, group]) =>
      networkOutcomes(deps, preferences, networkId, group),
    ),
  );
  return Object.fromEntries(perNetwork.flat());
};

/**
 * Reconciles one account/network scope and returns that scope's entries,
 * newest-first. A status query failure leaves those hashes as they were rather
 * than exposing or modifying another account's rows.
 */
export const reconcileScope = async (
  deps: ReconcileDeps,
  scope: ActivityScope,
  nowMs: number,
  includeSlow = false,
): Promise<readonly ActivityEntry[]> => {
  // A background alarm may be waiting through multiple RPC fallbacks. The
  // Activity view must remain responsive: return its current durable snapshot
  // instead of queueing user-visible work behind an unrelated network poll.
  if (pendingReconciliations > 0) {
    return activityForScope(await deps.activity.list(), scope);
  }
  return runReconciliation(async () => {
    const entries = activityForScope(await deps.activity.list(), scope);
    const due = entries.filter((entry) =>
      includeSlow ? isObserved(entry, nowMs) : isObservedAt(entry, "fast", nowMs),
    );
    const outcomes = { ...expiredOutcomes(entries, nowMs), ...(await chainOutcomes(deps, due)) };
    return Object.keys(outcomes).length === 0
      ? entries
      : deps.activity.updateStatuses(outcomes, scope);
  });
};

/**
 * Serializes a discovered-history merge with every status reconciliation.
 * `lane` names where `onChain` came from; only the wallet's own event scan may
 * settle a transaction still under observation (see `mergeActivity`).
 */
export const mergeReconciledHistory = (
  deps: ReconcileDeps,
  scope: ActivityScope,
  onChain: readonly ActivityEntry[],
  lane: HistoryLane,
): Promise<readonly ActivityEntry[]> =>
  runReconciliation(async () => {
    // Stored rows planted before audit #163's decoder filter are purged here,
    // and replaceScope writes the cleaned scope back.
    const stored = withoutPlantedRows(activityForScope(await deps.activity.list(), scope));
    const merged = mergeActivity(stored, onChain, lane);
    await deps.activity.replaceScope?.(merged, scope).catch(() => undefined);
    return merged;
  });

/**
 * Reconciles every scope that has a transaction due on the given cadence. Used
 * by the background alarms, where there is no "active account" — a transaction
 * sent from an account the user has since switched away from must still be
 * verified through to L1 finality.
 *
 * Expired unresolved transactions are retired on the fast cadence only, since
 * that is the tier their window belongs to.
 */
export const reconcileObserved = async (
  deps: ReconcileDeps,
  tier: ObservationTier,
  nowMs: number,
): Promise<void> =>
  runReconciliation(async () => {
    const entries = await deps.activity.list();
    const due = entries.filter((entry) => isObservedAt(entry, tier, nowMs));
    const expired = tier === "fast" ? expiredOutcomes(entries, nowMs) : {};
    const outcomes = { ...expired, ...(await chainOutcomes(deps, due)) };
    const touched = entries.filter((entry) => outcomes[entry.hash] !== undefined);
    for (const scope of byScope(touched)) {
      await deps.activity.updateStatuses(outcomes, scope);
    }
  });
