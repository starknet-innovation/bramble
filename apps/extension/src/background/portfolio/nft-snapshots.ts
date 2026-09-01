/** Durable last-known NFT ownership snapshots for low-latency gallery hydration. */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { type DiscoveredNft, isDiscoveredNft } from "@mc-wallet/portfolio/nft-metadata";
import type { KeyValueStore } from "@mc-wallet/store/kv";
import { serializeStoreMutations } from "@mc-wallet/store/mutation";
import { isAccountIdForNetwork } from "@mc-wallet/wallet-model/accounts";
import { isStarknetNetworkId, type StarknetNetworkId } from "@mc-wallet/wallet-model/networks";

/**
 * Public browser-storage key for bounded NFT ownership snapshots.
 */
export const NFT_SNAPSHOTS_KEY = "mc-wallet:nft-snapshots";
const MAX_SNAPSHOTS = 100;

/**
 * Independent NFT discovery lanes retained for an account.
 */
export type NftSnapshotLane = "complete" | "indexed" | "watched";

type NftSnapshot = {
  readonly accountId: string;
  readonly checkedAt: number;
  readonly fetchedAt: number;
  readonly lane: NftSnapshotLane;
  readonly networkId: StarknetNetworkId;
  readonly nfts: readonly DiscoveredNft[];
};

type NftSnapshotValue = Pick<NftSnapshot, "checkedAt" | "fetchedAt" | "nfts">;

/**
 * Bounded public snapshot storage; never contains signing or viewing secrets.
 */
export type NftSnapshotStore = {
  readonly clearAll: () => Promise<void>;
  readonly clear: (accountId: string, networkId: StarknetNetworkId) => Promise<void>;
  readonly read: (
    accountId: string,
    networkId: StarknetNetworkId,
    lane: NftSnapshotLane,
  ) => Promise<NftSnapshotValue | null>;
  readonly touch: (
    accountId: string,
    networkId: StarknetNetworkId,
    lane: NftSnapshotLane,
    checkedAt: number,
  ) => Promise<void>;
  readonly write: (snapshot: NftSnapshot) => Promise<void>;
};

const isLane = (value: unknown): value is NftSnapshotLane =>
  value === "complete" || value === "indexed" || value === "watched";

const isSnapshot = (value: unknown): value is NftSnapshot =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "checkedAt", "fetchedAt", "lane", "networkId", "nfts"]) &&
  isStarknetNetworkId(value["networkId"]) &&
  isAccountIdForNetwork(value["accountId"], value["networkId"]) &&
  typeof value["checkedAt"] === "number" &&
  Number.isSafeInteger(value["checkedAt"]) &&
  value["checkedAt"] >= 0 &&
  typeof value["fetchedAt"] === "number" &&
  Number.isSafeInteger(value["fetchedAt"]) &&
  value["fetchedAt"] >= 0 &&
  isLane(value["lane"]) &&
  Array.isArray(value["nfts"]) &&
  value["nfts"].every((nft) => isDiscoveredNft(nft) && nft.networkId === value["networkId"]) &&
  new Set(value["nfts"].map((nft) => nft.id)).size === value["nfts"].length;

const readSnapshots = async (store: KeyValueStore): Promise<readonly NftSnapshot[]> => {
  const stored = await store.get(NFT_SNAPSHOTS_KEY);
  return Array.isArray(stored) ? stored.filter(isSnapshot).slice(-MAX_SNAPSHOTS) : [];
};

/**
 * Creates a validated, bounded public NFT snapshot store.
 */
export const createNftSnapshotStore = (store: KeyValueStore): NftSnapshotStore =>
  serializeStoreMutations<NftSnapshotStore>(
    {
      async clearAll() {
        await store.set(NFT_SNAPSHOTS_KEY, []);
      },
      async clear(accountId, networkId) {
        await store.set(
          NFT_SNAPSHOTS_KEY,
          (await readSnapshots(store)).filter(
            (snapshot) => snapshot.accountId !== accountId || snapshot.networkId !== networkId,
          ),
        );
      },
      async read(accountId, networkId, lane) {
        const snapshot = (await readSnapshots(store)).find(
          (stored) =>
            stored.accountId === accountId &&
            stored.networkId === networkId &&
            stored.lane === lane,
        );
        return snapshot
          ? { checkedAt: snapshot.checkedAt, fetchedAt: snapshot.fetchedAt, nfts: snapshot.nfts }
          : null;
      },
      async touch(accountId, networkId, lane, checkedAt) {
        const snapshots = await readSnapshots(store);
        const current = snapshots.find(
          (snapshot) =>
            snapshot.accountId === accountId &&
            snapshot.networkId === networkId &&
            snapshot.lane === lane,
        );
        if (!current || !Number.isSafeInteger(checkedAt) || checkedAt < 0) return;
        await store.set(
          NFT_SNAPSHOTS_KEY,
          snapshots.map((snapshot) =>
            snapshot === current ? { ...current, checkedAt } : snapshot,
          ),
        );
      },
      async write(snapshot) {
        if (!isSnapshot(snapshot)) return;
        const retained = (await readSnapshots(store)).filter(
          (stored) =>
            stored.accountId !== snapshot.accountId ||
            stored.networkId !== snapshot.networkId ||
            stored.lane !== snapshot.lane,
        );
        await store.set(NFT_SNAPSHOTS_KEY, [...retained, snapshot].slice(-MAX_SNAPSHOTS));
      },
    },
    ["read"],
  );
