/** Small local cache for rollback checkpoints and account-attributed summaries. */
import { hasOnlyKnownKeys, isRecord, isStringArray } from "@mc-wallet/core/json";
import type { KeyValueStore } from "@mc-wallet/store/kv";
import { serializeStoreMutations } from "@mc-wallet/store/mutation";
import { isAccountIdForNetwork } from "@mc-wallet/wallet-model/accounts";
import { isStarkFieldElement, type StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import { isPrivacyScoreState, type PrivacyScoreState } from "./score-types";

const STORE_KEY = "mc-wallet:privacy-score";
const MAX_ACCOUNT_SUMMARIES = 50;
const MAX_TRANSACTION_KEYS = 200;

/**
 * Highest verified finalized artifact accepted for the configured pool.
 */
export type PrivacyScoreCheckpoint = {
  readonly snapshotBlockHash: string;
  readonly snapshotBlockNumber: number;
};

/**
 * Small account-local association retained for offline display and refresh throttling.
 */
export type PrivacyScoreCacheEntry = {
  readonly accountId: string;
  readonly checkedAt: number;
  readonly networkId: StarknetNetworkId;
  readonly score: PrivacyScoreState;
  readonly transactionKeys: readonly string[];
};

type PrivacyScoreCacheState = {
  readonly accounts: readonly PrivacyScoreCacheEntry[];
  readonly checkpoint?: PrivacyScoreCheckpoint;
  readonly schemaVersion: 1;
};

/**
 * Persistence surface used by the score coordinator.
 */
export type PrivacyScoreCache = {
  readonly read: () => Promise<PrivacyScoreCacheState>;
  readonly write: (
    checkpoint: PrivacyScoreCheckpoint,
    account: PrivacyScoreCacheEntry,
  ) => Promise<void>;
};

const emptyState = (): PrivacyScoreCacheState => ({ accounts: [], schemaVersion: 1 });

const isSafeNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isCheckpoint = (value: unknown): value is PrivacyScoreCheckpoint =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["snapshotBlockHash", "snapshotBlockNumber"]) &&
  typeof value["snapshotBlockHash"] === "string" &&
  isStarkFieldElement(value["snapshotBlockHash"]) &&
  isSafeNonNegative(value["snapshotBlockNumber"]);

const isCacheEntry = (value: unknown): value is PrivacyScoreCacheEntry =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "checkedAt", "networkId", "score", "transactionKeys"]) &&
  value["networkId"] === "SN_MAIN" &&
  isAccountIdForNetwork(value["accountId"], value["networkId"]) &&
  isSafeNonNegative(value["checkedAt"]) &&
  isPrivacyScoreState(value["score"]) &&
  isStringArray(value["transactionKeys"]) &&
  value["transactionKeys"].length <= MAX_TRANSACTION_KEYS &&
  value["transactionKeys"].every((key) => key.length <= 80);

const readState = async (store: KeyValueStore): Promise<PrivacyScoreCacheState> => {
  const value = await store.get(STORE_KEY);
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["accounts", "checkpoint", "schemaVersion"]) ||
    value["schemaVersion"] !== 1 ||
    !Array.isArray(value["accounts"]) ||
    value["accounts"].length > MAX_ACCOUNT_SUMMARIES ||
    !value["accounts"].every(isCacheEntry) ||
    (value["checkpoint"] !== undefined && !isCheckpoint(value["checkpoint"]))
  ) {
    return emptyState();
  }
  return {
    accounts: value["accounts"],
    ...(isCheckpoint(value["checkpoint"]) ? { checkpoint: value["checkpoint"] } : {}),
    schemaVersion: 1,
  };
};

/**
 * Creates the browser-local privacy-score cache. It stores only public
 * checkpoint metadata and small local associations, never the user's viewing
 * key or the service's large public snapshot.
 */
export const createPrivacyScoreCache = (store: KeyValueStore): PrivacyScoreCache =>
  serializeStoreMutations<PrivacyScoreCache>(
    {
      read: () => readState(store),
      async write(checkpoint, account) {
        const current = await readState(store);
        const retained = current.accounts.filter(
          (entry) => entry.accountId !== account.accountId || entry.networkId !== account.networkId,
        );
        await store.set(STORE_KEY, {
          accounts: [...retained, account].slice(-MAX_ACCOUNT_SUMMARIES),
          checkpoint,
          schemaVersion: 1,
        });
      },
    },
    ["read"],
  );
