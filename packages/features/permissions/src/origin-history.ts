/**
 * Per-origin site-reputation history: the first time this wallet saw a dapp
 * origin. Plain data kept outside the encrypted vault, like the activity log.
 * The clock is injected so this module never touches `Date.now` directly and
 * stays deterministic in tests.
 */
import { isRecord } from "@bramble/core/json";
import { isWalletOrigin } from "@bramble/core/origin";
import type { KeyValueStore } from "@bramble/store/kv";
import { serializeStoreMutations } from "@bramble/store/mutation";

/**
 * Browser storage key for the origin first-seen history.
 */
export const ORIGIN_HISTORY_STORE_KEY = "mc-wallet:origin-history";

const MAX_ORIGINS = 500;

/**
 * Origin first-seen history surface used by background message handling.
 */
export type OriginHistoryStore = {
  readonly firstSeen: (origin: string) => Promise<number | null>;
  readonly now: () => number;
  readonly record: (origin: string) => Promise<number>;
};

const isTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const readMap = async (store: KeyValueStore): Promise<Record<string, number>> => {
  const stored = await store.get(ORIGIN_HISTORY_STORE_KEY);
  if (!isRecord(stored)) {
    return {};
  }
  const result: Record<string, number> = {};
  for (const key of Object.keys(stored)) {
    const value = stored[key];
    if (isWalletOrigin(key) && isTimestamp(value)) {
      result[key] = value;
    }
  }
  return result;
};

const pruneOldest = (map: Record<string, number>): Record<string, number> => {
  const origins = Object.keys(map);
  if (origins.length <= MAX_ORIGINS) {
    return map;
  }
  const kept = origins
    .sort((left, right) => (map[right] ?? 0) - (map[left] ?? 0))
    .slice(0, MAX_ORIGINS);
  return Object.fromEntries(kept.map((origin) => [origin, map[origin] ?? 0]));
};

/**
 * Creates the persistent origin history store over a namespaced key-value
 * store. `record` sets the first-seen timestamp once per origin; later calls
 * return the original timestamp so reputation stays stable.
 */
export const createOriginHistoryStore = ({
  now,
  store,
}: {
  readonly now: () => number;
  readonly store: KeyValueStore;
}): OriginHistoryStore =>
  serializeStoreMutations<OriginHistoryStore>(
    {
      async firstSeen(origin) {
        const map = await readMap(store);
        return map[origin] ?? null;
      },
      now,
      async record(origin) {
        if (!isWalletOrigin(origin)) {
          return now();
        }
        const map = await readMap(store);
        const existing = map[origin];
        if (existing !== undefined) {
          return existing;
        }
        const at = now();
        await store.set(ORIGIN_HISTORY_STORE_KEY, pruneOldest({ ...map, [origin]: at }));
        return at;
      },
    },
    ["firstSeen", "now"],
  );

/**
 * In-memory origin history used as the test and fallback default.
 */
export const memoryOriginHistory = (now: () => number = () => 0): OriginHistoryStore => {
  const entries = new Map<string, number>();
  return {
    async firstSeen(origin) {
      return entries.get(origin) ?? null;
    },
    now,
    async record(origin) {
      if (!isWalletOrigin(origin)) {
        return now();
      }
      const existing = entries.get(origin);
      if (existing !== undefined) {
        return existing;
      }
      const at = now();
      entries.set(origin, at);
      return at;
    },
  };
};
