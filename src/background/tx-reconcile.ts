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
import { STARKNET_NETWORKS, type StarknetNetworkId } from "../starknet/networks";
import type { TransactionStatusReport } from "../starknet/rpc";
import {
  type ActivityEntry,
  type ActivityLog,
  type ActivityOutcome,
  type ActivityScope,
  activityForScope,
} from "../storage/activity-store";
import type { WalletPreferencesStore } from "../storage/preferences-store";
import type { RuntimeRpc } from "./runtime-rpc";
import { networkRpcUrls } from "./runtime-state";
import {
  expiredObservations,
  isObserved,
  isObservedAt,
  type ObservationTier,
  reconciledOutcome,
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

const byNetwork = (
  entries: readonly ActivityEntry[],
): ReadonlyMap<StarknetNetworkId, readonly string[]> => {
  const grouped = new Map<StarknetNetworkId, readonly string[]>();
  for (const entry of entries) {
    grouped.set(entry.networkId, [...(grouped.get(entry.networkId) ?? []), entry.hash]);
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

// Retiring an entry that never resolved leaves its status alone — the wallet
// does not know the outcome — and only records the notice it owes the user.
const expiredOutcomes = (
  entries: readonly ActivityEntry[],
  nowMs: number,
): Readonly<Record<string, ActivityOutcome>> =>
  Object.fromEntries(
    expiredObservations(entries, nowMs).map((entry) => [
      entry.hash,
      { failureNotice: "pending", status: entry.status } as const,
    ]),
  );

// Reads the chain for the given entries. A network whose status query fails
// contributes nothing, so its transactions simply stay under observation rather
// than being misread as gone.
const chainOutcomes = async (
  deps: ReconcileDeps,
  entries: readonly ActivityEntry[],
): Promise<Readonly<Record<string, ActivityOutcome>>> => {
  if (entries.length === 0) {
    return {};
  }
  const preferences = await deps.preferencesStore.read();
  let outcomes: Record<string, ActivityOutcome> = {};
  for (const [networkId, hashes] of byNetwork(entries)) {
    const reports: Readonly<Record<string, TransactionStatusReport>> = await deps.runtimeRpc
      .getTransactionStatuses({
        hashes,
        rpcUrls: networkRpcUrls(STARKNET_NETWORKS[networkId], preferences),
      })
      .catch(() => ({}));
    for (const entry of entries) {
      const report = reports[entry.hash];
      if (entry.networkId === networkId && report !== undefined) {
        outcomes = { ...outcomes, [entry.hash]: reconciledOutcome(entry, report) };
      }
    }
  }
  return outcomes;
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
): Promise<readonly ActivityEntry[]> => {
  const entries = activityForScope(await deps.activity.list(), scope);
  const due = entries.filter((entry) => isObserved(entry, nowMs));
  const outcomes = { ...expiredOutcomes(entries, nowMs), ...(await chainOutcomes(deps, due)) };
  return Object.keys(outcomes).length === 0
    ? entries
    : deps.activity.updateStatuses(outcomes, scope);
};

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
): Promise<void> => {
  const entries = await deps.activity.list();
  const due = entries.filter((entry) => isObservedAt(entry, tier, nowMs));
  const expired = tier === "fast" ? expiredOutcomes(entries, nowMs) : {};
  const outcomes = { ...expired, ...(await chainOutcomes(deps, due)) };
  const touched = entries.filter((entry) => outcomes[entry.hash] !== undefined);
  for (const scope of byScope(touched)) {
    await deps.activity.updateStatuses(outcomes, scope);
  }
};
