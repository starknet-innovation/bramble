/** Session-only cache for public account-recovery discovery progress. */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { createMemoryStore, type KeyValueStore } from "@mc-wallet/store/kv";
import {
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";
import {
  isRecoveryAccountCandidate,
  isRecoveryAccountIndex,
  type RecoveryAccountCandidate,
} from "@mc-wallet/wallet-model/recovery";

const RECOVERY_DISCOVERY_KEY = "mc-wallet:recovery-discovery";

/** Public progress retained across service-worker restarts, never across browser restarts. */
type RecoveryDiscoverySnapshot = {
  readonly candidates: readonly RecoveryAccountCandidate[];
  readonly fingerprint: string;
  readonly networkId: StarknetNetworkId;
  readonly nextIndex: number;
};

/** Validated session cache for one in-progress recovery scan. */
export type RecoveryDiscoveryCache = {
  readonly read: () => Promise<RecoveryDiscoverySnapshot | null>;
  readonly write: (snapshot: RecoveryDiscoverySnapshot) => Promise<void>;
};

const isSnapshot = (value: unknown): value is RecoveryDiscoverySnapshot =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["candidates", "fingerprint", "networkId", "nextIndex"]) &&
  Array.isArray(value["candidates"]) &&
  value["candidates"].every(isRecoveryAccountCandidate) &&
  typeof value["fingerprint"] === "string" &&
  isNonZeroStarkFieldElement(value["fingerprint"]) &&
  isStarknetNetworkId(value["networkId"]) &&
  isRecoveryAccountIndex(value["nextIndex"]);

/** Creates the session-backed cache, falling back to memory in tests. */
export const createRecoveryDiscoveryCache = (
  store: KeyValueStore = createMemoryStore(),
): RecoveryDiscoveryCache => ({
  async read() {
    const value = await store.get(RECOVERY_DISCOVERY_KEY);
    return isSnapshot(value) ? value : null;
  },
  async write(snapshot) {
    if (isSnapshot(snapshot)) await store.set(RECOVERY_DISCOVERY_KEY, snapshot);
  },
});
