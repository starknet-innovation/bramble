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
import {
  TRANSACTION_STATUS_CONCURRENCY,
  type TransactionFee,
  type TransactionStatusReport,
} from "@bramble/starknet/rpc";
import {
  type ActivityEntry,
  type ActivityLog,
  type ActivityOutcome,
  type ActivityScope,
  activityForScope,
} from "@bramble/transactions/activity";
import { mergeActivity, withoutPlantedRows } from "@bramble/transactions/tx-history";
import {
  canonicalFelt,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import {
  expiredObservations,
  isObserved,
  isObservedAt,
  L1_FINALITY_WINDOW_MS,
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
const hasReceipt = (status: ActivityOutcome["status"]): boolean =>
  status === "accepted" || status === "reverted";

// Only rows this wallet submitted get a fee: a receipt's fee is paid by the
// transaction's sender, so on a discovered incoming transfer it is someone
// else's, and so is a sponsored deployment's, which the sponsor's relay sent.
// A recorded fee is final and never read again.
const wantsFee = (entry: ActivityEntry, status: ActivityOutcome["status"]): boolean =>
  entry.origin === "wallet" &&
  entry.feePayer === undefined &&
  entry.feePaid === undefined &&
  hasReceipt(status);

/**
 * Wallet rows read for a missing fee per slow pass beyond those a status read
 * already covers. A reverted or L1-final row is never observed again, so
 * without this a single failed fee read would lose its fee for good.
 */
const FEE_BACKFILL_LIMIT = TRANSACTION_STATUS_CONCURRENCY;

const feeBackfill = (
  entries: readonly ActivityEntry[],
  due: readonly ActivityEntry[],
  nowMs: number,
): readonly ActivityEntry[] =>
  entries
    .filter(
      (entry) =>
        !due.includes(entry) &&
        wantsFee(entry, entry.status) &&
        nowMs - entry.submittedAt < L1_FINALITY_WINDOW_MS,
    )
    .slice(0, FEE_BACKFILL_LIMIT);

// Reads the receipt fee for each candidate. A failed or missing read records
// nothing; the row is read again on a later pass (its own observation while it
// is still observed, the slow-pass backfill after that).
const receiptFees = async (
  deps: ReconcileDeps,
  rpcUrls: readonly string[],
  candidates: readonly ActivityEntry[],
): Promise<Readonly<Record<string, TransactionFee>>> => {
  const read = deps.runtimeRpc.getTransactionFees;
  if (read === undefined || candidates.length === 0) {
    return {};
  }
  return read({ hashes: candidates.map((entry) => entry.hash), rpcUrls }).catch(() => ({}));
};

// Reads one network's transactions: the status of every due entry, then the
// fee of each wallet row that now has a receipt and of each backfill row. A
// failed status query contributes nothing, so those transactions simply stay
// under observation rather than being misread as gone; a backfill row
// contributes only when its fee is found.
const networkOutcomes = async (
  deps: ReconcileDeps,
  preferences: WalletPreferences,
  networkId: StarknetNetworkId,
  due: readonly ActivityEntry[],
  backfill: readonly ActivityEntry[],
): Promise<readonly (readonly [string, ActivityOutcome])[]> => {
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[networkId], preferences);
  const reports: Readonly<Record<string, TransactionStatusReport>> =
    due.length === 0
      ? {}
      : await deps.runtimeRpc
          .getTransactionStatuses({ hashes: due.map((entry) => entry.hash), rpcUrls })
          .catch(() => ({}));
  const outcomes = due.flatMap((entry) => {
    const report = reports[entry.hash];
    return report === undefined ? [] : [[entry, reconciledOutcome(entry, report)] as const];
  });
  const fees = await receiptFees(deps, rpcUrls, [
    ...outcomes
      .filter(([entry, outcome]) => wantsFee(entry, outcome.status))
      .map(([entry]) => entry),
    ...backfill,
  ]);
  const withFee = (entry: ActivityEntry, outcome: ActivityOutcome): ActivityOutcome => {
    const feePaid = fees[entry.hash];
    return feePaid === undefined ? outcome : { ...outcome, feePaid };
  };
  return [
    ...outcomes.map(([entry, outcome]) => [entry.hash, withFee(entry, outcome)] as const),
    ...backfill.flatMap((entry) => {
      const feePaid = fees[entry.hash];
      return feePaid === undefined
        ? []
        : [[entry.hash, { feePaid, status: entry.status }] as const];
    }),
  ];
};

// Reads the chain for the given entries, one query per network. Networks are
// independent endpoints, so their reads overlap rather than adding up their
// round-trips.
const chainOutcomes = async (
  deps: ReconcileDeps,
  due: readonly ActivityEntry[],
  backfill: readonly ActivityEntry[] = [],
): Promise<Readonly<Record<string, ActivityOutcome>>> => {
  if (due.length === 0 && backfill.length === 0) {
    return {};
  }
  const preferences = await deps.preferencesStore.read();
  const dueByNetwork = byNetwork(due);
  const backfillByNetwork = byNetwork(backfill);
  const networks = new Set([...dueByNetwork.keys(), ...backfillByNetwork.keys()]);
  const perNetwork = await Promise.all(
    [...networks].map((networkId) =>
      networkOutcomes(
        deps,
        preferences,
        networkId,
        dueByNetwork.get(networkId) ?? [],
        backfillByNetwork.get(networkId) ?? [],
      ),
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
    const backfill = includeSlow ? feeBackfill(entries, due, nowMs) : [];
    const outcomes = {
      ...expiredOutcomes(entries, nowMs),
      ...(await chainOutcomes(deps, due, backfill)),
    };
    return Object.keys(outcomes).length === 0
      ? entries
      : deps.activity.updateStatuses(outcomes, scope);
  });
};

// A reverted transaction still pays its fee, and that payment emits a Transfer
// from the account, so a chain-only outgoing leg on its own does not show the
// transaction succeeded (#656). Each outgoing transaction new to this scope is
// read once, before it is stored; one the receipt shows reverted keeps its row,
// marked reverted, so the fee it paid stays visible without reading as a
// completed send. Incoming legs need no read: a reverted transaction emits no
// event but its sender's fee. A failed read leaves rows as found, included in
// a block, exactly as before.
const withRevertedChainLegs = async (
  deps: ReconcileDeps,
  scope: ActivityScope,
  stored: readonly ActivityEntry[],
  onChain: readonly ActivityEntry[],
): Promise<readonly ActivityEntry[]> => {
  const known = new Set(stored.map((entry) => canonicalFelt(entry.hash) ?? entry.hash));
  const hashes = [
    ...new Set(
      onChain
        .filter((entry) => entry.direction === "out" && entry.status === "accepted")
        .map((entry) => entry.hash)
        .filter((hash) => !known.has(canonicalFelt(hash) ?? hash)),
    ),
  ];
  if (hashes.length === 0) {
    return onChain;
  }
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[scope.networkId], preferences);
  const reports: Readonly<Record<string, TransactionStatusReport>> = await deps.runtimeRpc
    .getTransactionStatuses({ hashes, rpcUrls })
    .catch(() => ({}));
  return onChain.map((entry) =>
    reports[entry.hash]?.status === "reverted" ? { ...entry, status: "reverted" } : entry,
  );
};

/**
 * Serializes a discovered-history merge with every status reconciliation.
 * Discovered rows never settle a transaction still under observation; only the
 * status re-poll does (see `mergeActivity`). A chain-only outgoing transaction
 * the receipt shows reverted is stored as reverted, not as a completed send.
 */
export const mergeReconciledHistory = (
  deps: ReconcileDeps,
  scope: ActivityScope,
  onChain: readonly ActivityEntry[],
): Promise<readonly ActivityEntry[]> =>
  runReconciliation(async () => {
    // Stored rows planted before audit #163's decoder filter are purged here,
    // and replaceScope writes the cleaned scope back.
    const stored = withoutPlantedRows(activityForScope(await deps.activity.list(), scope));
    const merged = mergeActivity(stored, await withRevertedChainLegs(deps, scope, stored, onChain));
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
    const backfill = tier === "slow" ? feeBackfill(entries, due, nowMs) : [];
    const outcomes = { ...expired, ...(await chainOutcomes(deps, due, backfill)) };
    const touched = entries.filter((entry) => outcomes[entry.hash] !== undefined);
    for (const scope of byScope(touched)) {
      await deps.activity.updateStatuses(outcomes, scope);
    }
  });
