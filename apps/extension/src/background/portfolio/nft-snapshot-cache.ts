/** Cached-first NFT reads with bounded freshness and retry backoff. */
import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import { systemClock } from "@bramble/transactions/activity";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { WalletOpsDeps } from "../accounts/wallet-ops";
import type { NftSnapshotLane, NftSnapshotStore } from "./nft-snapshots";

const NFT_SNAPSHOT_TTL_MS = 2 * 60_000;
const NFT_RETRY_BACKOFF_MS = 60_000;
const refreshes = new WeakMap<NftSnapshotStore, Map<string, Promise<DiscoveredNft[]>>>();

const refreshSnapshot = (
  store: NftSnapshotStore,
  input: {
    readonly accountId: string;
    readonly fetchedAt: number;
    readonly lane: NftSnapshotLane;
    readonly networkId: StarknetNetworkId;
  },
  load: () => Promise<DiscoveredNft[]>,
): Promise<DiscoveredNft[]> => {
  const key = `${input.networkId}:${input.accountId}:${input.lane}`;
  const active = refreshes.get(store) ?? new Map<string, Promise<DiscoveredNft[]>>();
  refreshes.set(store, active);
  const running = active.get(key);
  if (running) return running;
  const refresh = load()
    .then(async (nfts) => {
      await store.write({ ...input, checkedAt: input.fetchedAt, nfts }).catch(() => undefined);
      return nfts;
    })
    .finally(() => active.delete(key));
  active.set(key, refresh);
  return refresh;
};

/**
 * Returns a validated local snapshot immediately when requested, otherwise
 * refreshes snapshots older than two minutes. Failed refreshes retain the last
 * ownership proof and wait one minute before another expensive verification.
 */
export const cachedNfts = async (
  deps: WalletOpsDeps,
  input: {
    readonly accountId: string;
    readonly lane: NftSnapshotLane;
    readonly networkId: StarknetNetworkId;
  },
  load: () => Promise<DiscoveredNft[]>,
  cachedOnly: boolean,
): Promise<DiscoveredNft[]> => {
  const store = deps.nftSnapshots;
  if (!store) return load();
  const now = (deps.now ?? systemClock)();
  const cached = await store.read(input.accountId, input.networkId, input.lane).catch(() => null);
  if (cachedOnly) return cached ? [...cached.nfts] : [];
  if (cached && cached.fetchedAt <= now && now - cached.fetchedAt < NFT_SNAPSHOT_TTL_MS) {
    return [...cached.nfts];
  }
  if (cached && cached.checkedAt <= now && now - cached.checkedAt < NFT_RETRY_BACKOFF_MS) {
    return [...cached.nfts];
  }
  try {
    return await refreshSnapshot(store, { ...input, fetchedAt: now }, load);
  } catch (error) {
    if (cached) {
      await store.touch(input.accountId, input.networkId, input.lane, now).catch(() => undefined);
      return [...cached.nfts];
    }
    throw error;
  }
};
