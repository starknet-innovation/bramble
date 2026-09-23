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
  isStarkFieldElement,
  isStarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";

const STORE_KEY = "bramble:strk20-maturity";
const MAX_RECORDS = 100;

type StoredMaturity = Strk20MaturityRecord & Strk20MaturityScope;

// A submitting record either names nothing yet, or names the complete signed
// write: hash, sender, and nonce together, each a canonical field element (the
// nonce may be zero). A partial identity could not resolve anything and is
// dropped like any other malformed entry.
const isSubmittingIdentity = (value: Record<string, unknown>): boolean =>
  value["acceptedBlock"] === undefined &&
  ((value["transactionHash"] === undefined &&
    value["senderAddress"] === undefined &&
    value["nonce"] === undefined) ||
    (typeof value["transactionHash"] === "string" &&
      isNonZeroStarkFieldElement(value["transactionHash"]) &&
      typeof value["senderAddress"] === "string" &&
      isNonZeroStarkFieldElement(value["senderAddress"]) &&
      typeof value["nonce"] === "string" &&
      isStarkFieldElement(value["nonce"])));

const isStoredMaturity = (value: unknown): value is StoredMaturity =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "acceptedBlock",
    "accountId",
    "networkId",
    "nonce",
    "poolAddress",
    "senderAddress",
    "state",
    "transactionHash",
  ]) &&
  typeof value["networkId"] === "string" &&
  isStarknetNetworkId(value["networkId"]) &&
  isAccountIdForNetwork(value["accountId"], value["networkId"]) &&
  typeof value["poolAddress"] === "string" &&
  isNonZeroStarkFieldElement(value["poolAddress"]) &&
  ((value["state"] === "submitting" && isSubmittingIdentity(value)) ||
    (value["state"] === "submitted" &&
      value["senderAddress"] === undefined &&
      value["nonce"] === undefined &&
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
          return entry.transactionHash === undefined
            ? { state: "submitting" }
            : {
                nonce: entry.nonce,
                senderAddress: entry.senderAddress,
                state: "submitting",
                transactionHash: entry.transactionHash,
              };
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
