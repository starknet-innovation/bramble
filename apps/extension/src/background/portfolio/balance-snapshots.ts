/** Durable last-known public balance snapshots for instant wallet hydration. */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { isTokenBalance, type TokenBalance } from "@mc-wallet/starknet/rpc";
import { createMemoryStore, type KeyValueStore } from "@mc-wallet/store/kv";
import { serializeStoreMutations } from "@mc-wallet/store/mutation";
import { isAccountIdForNetwork } from "@mc-wallet/wallet-model/accounts";
import { isStarknetNetworkId, type StarknetNetworkId } from "@mc-wallet/wallet-model/networks";

/**
 * Browser-local key for bounded, non-secret portfolio snapshots.
 */
export const BALANCE_SNAPSHOTS_KEY = "mc-wallet:balance-snapshots";

const MAX_SCOPES = 50;
const BALANCE_SNAPSHOT_TTL_MS = 60_000;

/**
 * Public account balance snapshot retained outside the encrypted vault.
 */
type BalanceSnapshot = {
  readonly accountId: string;
  readonly balances: readonly TokenBalance[];
  readonly fetchedAt: number;
  readonly networkId: StarknetNetworkId;
};

type BalanceSnapshotValue = Pick<BalanceSnapshot, "balances" | "fetchedAt">;

const refreshes = new WeakMap<BalanceSnapshotStore, Map<string, Promise<BalanceSnapshotValue>>>();

const refreshBalances = (
  store: BalanceSnapshotStore,
  input: {
    readonly accountId: string;
    readonly networkId: StarknetNetworkId;
    readonly now: number;
  },
  load: () => Promise<readonly TokenBalance[]>,
): Promise<BalanceSnapshotValue> => {
  const key = `${input.networkId}:${input.accountId}`;
  const active = refreshes.get(store) ?? new Map<string, Promise<BalanceSnapshotValue>>();
  refreshes.set(store, active);
  const running = active.get(key);
  if (running) return running;
  const refresh = load()
    .then(async (balances) => {
      const value = { balances, fetchedAt: input.now };
      await store
        .write({
          accountId: input.accountId,
          balances,
          fetchedAt: input.now,
          networkId: input.networkId,
        })
        .catch(() => undefined);
      return value;
    })
    .finally(() => active.delete(key));
  active.set(key, refresh);
  return refresh;
};

/**
 * Background-owned balance cache; callers still refresh from RPC after reads.
 */
export type BalanceSnapshotStore = {
  readonly read: (
    accountId: string,
    networkId: StarknetNetworkId,
  ) => Promise<BalanceSnapshotValue | null>;
  readonly write: (snapshot: BalanceSnapshot) => Promise<void>;
};

const isSnapshot = (value: unknown): value is BalanceSnapshot =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "balances", "fetchedAt", "networkId"]) &&
  isStarknetNetworkId(value["networkId"]) &&
  isAccountIdForNetwork(value["accountId"], value["networkId"]) &&
  typeof value["fetchedAt"] === "number" &&
  Number.isSafeInteger(value["fetchedAt"]) &&
  value["fetchedAt"] >= 0 &&
  Array.isArray(value["balances"]) &&
  value["balances"].every(
    (balance) => isTokenBalance(balance) && balance.networkId === value["networkId"],
  ) &&
  new Set(value["balances"].map((balance) => balance.id)).size === value["balances"].length;

const readSnapshots = async (store: KeyValueStore): Promise<readonly BalanceSnapshot[]> => {
  const value = await store.get(BALANCE_SNAPSHOTS_KEY);
  return Array.isArray(value) ? value.filter(isSnapshot).slice(-MAX_SCOPES) : [];
};

/**
 * Creates a validated, bounded persistent snapshot store.
 */
export const createBalanceSnapshotStore = (store: KeyValueStore): BalanceSnapshotStore =>
  serializeStoreMutations<BalanceSnapshotStore>(
    {
      async read(accountId, networkId) {
        const snapshot = (await readSnapshots(store)).find(
          (stored) => stored.accountId === accountId && stored.networkId === networkId,
        );
        return snapshot ? { balances: snapshot.balances, fetchedAt: snapshot.fetchedAt } : null;
      },
      async write(snapshot) {
        if (!isSnapshot(snapshot)) return;
        const retained = (await readSnapshots(store)).filter(
          (stored) =>
            stored.accountId !== snapshot.accountId || stored.networkId !== snapshot.networkId,
        );
        await store.set(BALANCE_SNAPSHOTS_KEY, [...retained, snapshot].slice(-MAX_SCOPES));
      },
    },
    ["read"],
  );

/**
 * In-memory default for background unit tests.
 */
export const memoryBalanceSnapshotStore = (): BalanceSnapshotStore =>
  createBalanceSnapshotStore(createMemoryStore());

/**
 * Reads a balance snapshot, refreshing one account/network lane at most once
 * per minute unless a completed wallet action explicitly forces reconciliation.
 * Concurrent readers share one RPC load and a failed refresh retains the last
 * known public balances as stale.
 */
export const cachedBalances = async (
  store: BalanceSnapshotStore | undefined,
  input: {
    readonly accountId: string;
    readonly cachedOnly: boolean;
    readonly force: boolean;
    readonly networkId: StarknetNetworkId;
    readonly now: number;
  },
  load: () => Promise<readonly TokenBalance[]>,
): Promise<(BalanceSnapshotValue & { readonly stale: boolean }) | null> => {
  if (!store) {
    return input.cachedOnly ? null : { balances: await load(), fetchedAt: input.now, stale: false };
  }
  const snapshot = await store.read(input.accountId, input.networkId).catch(() => null);
  const fresh =
    snapshot !== null &&
    snapshot.fetchedAt > 0 &&
    snapshot.fetchedAt <= input.now &&
    input.now - snapshot.fetchedAt < BALANCE_SNAPSHOT_TTL_MS;
  if (input.cachedOnly || (fresh && !input.force)) {
    return snapshot ? { ...snapshot, stale: !fresh } : null;
  }

  try {
    return { ...(await refreshBalances(store, input, load)), stale: false };
  } catch (error) {
    if (snapshot) return { ...snapshot, stale: true };
    throw error;
  }
};
