/**
 * Trusted browser-session persistence for the latest STRK20 write per
 * account/network/pool. It contains only public transaction metadata and
 * survives MV3 service-worker restarts, but clears when the browser exits.
 */

import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type {
  Strk20MaturityRecord,
  Strk20MaturityScope,
  Strk20MaturityStore,
} from "@bramble/privacy/maturity";
import type { KeyValueStore } from "@bramble/store/kv";
import { serializeStoreMutations } from "@bramble/store/mutation";
import { isAccountIdForNetwork } from "@bramble/wallet-model/accounts";
import {
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";

const STORE_KEY = "mc-wallet:strk20-maturity";
const MAX_RECORDS = 100;

type StoredMaturity = Strk20MaturityRecord & Strk20MaturityScope;

const isStoredMaturity = (value: unknown): value is StoredMaturity =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "acceptedBlock",
    "accountId",
    "networkId",
    "poolAddress",
    "state",
    "transactionHash",
  ]) &&
  typeof value["networkId"] === "string" &&
  isStarknetNetworkId(value["networkId"]) &&
  isAccountIdForNetwork(value["accountId"], value["networkId"]) &&
  typeof value["poolAddress"] === "string" &&
  isNonZeroStarkFieldElement(value["poolAddress"]) &&
  ((value["state"] === "submitting" &&
    value["transactionHash"] === undefined &&
    value["acceptedBlock"] === undefined) ||
    (value["state"] === "submitted" &&
      typeof value["transactionHash"] === "string" &&
      isNonZeroStarkFieldElement(value["transactionHash"]) &&
      (value["acceptedBlock"] === undefined ||
        (typeof value["acceptedBlock"] === "number" &&
          Number.isSafeInteger(value["acceptedBlock"]) &&
          value["acceptedBlock"] >= 0))));

const sameScope = (entry: StoredMaturity, scope: Strk20MaturityScope): boolean =>
  entry.accountId === scope.accountId &&
  entry.networkId === scope.networkId &&
  sameFelt(entry.poolAddress, scope.poolAddress);

const readAll = async (store: KeyValueStore): Promise<readonly StoredMaturity[]> => {
  const value = await store.get(STORE_KEY);
  return Array.isArray(value) ? value.filter(isStoredMaturity) : [];
};

/**
 * Creates the session-backed maturity store.
 */
export const createStrk20MaturityStore = (store: KeyValueStore): Strk20MaturityStore =>
  serializeStoreMutations<Strk20MaturityStore>(
    {
      async read(scope) {
        const entry = (await readAll(store)).find((candidate) => sameScope(candidate, scope));
        if (!entry) {
          return null;
        }
        if (entry.state === "submitting") {
          return { state: "submitting" };
        }
        return {
          ...(entry.acceptedBlock === undefined ? {} : { acceptedBlock: entry.acceptedBlock }),
          state: "submitted",
          transactionHash: entry.transactionHash,
        };
      },
      async write(scope, record) {
        const retained = (await readAll(store)).filter((entry) => !sameScope(entry, scope));
        const next = record ? [...retained, { ...scope, ...record }] : retained;
        await store.set(STORE_KEY, next.slice(-MAX_RECORDS));
      },
    },
    ["read"],
  );
