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

/**
 * Public account balance snapshot retained outside the encrypted vault.
 */
type BalanceSnapshot = {
  readonly accountId: string;
  readonly balances: readonly TokenBalance[];
  readonly networkId: StarknetNetworkId;
};

/**
 * Background-owned balance cache; callers still refresh from RPC after reads.
 */
export type BalanceSnapshotStore = {
  readonly read: (
    accountId: string,
    networkId: StarknetNetworkId,
  ) => Promise<readonly TokenBalance[] | null>;
  readonly write: (snapshot: BalanceSnapshot) => Promise<void>;
};

const isSnapshot = (value: unknown): value is BalanceSnapshot =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "balances", "networkId"]) &&
  isStarknetNetworkId(value["networkId"]) &&
  isAccountIdForNetwork(value["accountId"], value["networkId"]) &&
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
        return (
          (await readSnapshots(store)).find(
            (snapshot) => snapshot.accountId === accountId && snapshot.networkId === networkId,
          )?.balances ?? null
        );
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
