/**
 * Persistence for the latest STRK20 write per account/network/pool, in the
 * extension's local storage, so a `submitting` marker survives service-worker
 * restarts and browser restarts alike (mc-wallet #668). A browser restart used
 * to clear it without cancelling anything, so a relayed proof could still land
 * after the user retried. It holds public transaction metadata and, for a
 * relay claim, the pool storage slots its call writes once; no key material.
 */

import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import {
  isRelayClaimWithSlots,
  isUnsignedAccountClaim,
  maturityRecordNamesHash,
  type Strk20MaturityRecord,
  type Strk20MaturityScope,
  type Strk20MaturityStore,
} from "@bramble/privacy/maturity";
import { MAX_RELAY_CLAIM_SLOTS } from "@bramble/privacy/relay-claim-slots";
import type { KeyValueStore } from "@bramble/store/kv";
import { serializeStoreMutations } from "@bramble/store/mutation";
import { isAccountIdForNetwork } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
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
// An unsigned claim may name its route; a signed one is always the account's
// and names none. An unknown route is malformed rather than read as either.
// Only an unsigned `relay` claim may carry `WriteOnce` slots.
const isSubmittingIdentity = (value: Record<string, unknown>): boolean =>
  value["acceptedBlock"] === undefined &&
  ((value["transactionHash"] === undefined &&
    value["senderAddress"] === undefined &&
    value["nonce"] === undefined &&
    (value["route"] === undefined || value["route"] === "account" || value["route"] === "relay") &&
    (value["writeOnceSlots"] === undefined ||
      (value["route"] === "relay" && isWriteOnceSlots(value["writeOnceSlots"])))) ||
    (value["route"] === undefined &&
      value["writeOnceSlots"] === undefined &&
      typeof value["transactionHash"] === "string" &&
      isNonZeroStarkFieldElement(value["transactionHash"]) &&
      typeof value["senderAddress"] === "string" &&
      isNonZeroStarkFieldElement(value["senderAddress"]) &&
      typeof value["nonce"] === "string" &&
      isStarkFieldElement(value["nonce"])));

// Sorted, distinct, canonical non-zero felts, as `relayClaimSlots` returns them.
const isWriteOnceSlots = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= MAX_RELAY_CLAIM_SLOTS &&
  value.every(
    (slot: unknown, index) =>
      typeof slot === "string" &&
      canonicalFelt(slot) === slot &&
      isNonZeroStarkFieldElement(slot) &&
      (index === 0 || (value[index - 1] as string) < slot),
  );

const isBlockNumberOrAbsent = (value: unknown): boolean =>
  value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

const isStoredMaturity = (value: unknown): value is StoredMaturity =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "acceptedBlock",
    "accountId",
    "networkId",
    "nonce",
    "poolAddress",
    // Written by an interim build of mc-wallet 661 and no longer read. It is
    // tolerated, whatever its value, and dropped on read, so a marker that
    // build wrote is never mistaken for a malformed row and a clean scope.
    "proofBaseBlock",
    "route",
    "senderAddress",
    "state",
    "transactionHash",
    "writeOnceSlots",
  ]) &&
  typeof value["networkId"] === "string" &&
  isStarknetNetworkId(value["networkId"]) &&
  isAccountIdForNetwork(value["accountId"], value["networkId"]) &&
  typeof value["poolAddress"] === "string" &&
  isNonZeroStarkFieldElement(value["poolAddress"]) &&
  ((value["state"] === "submitting" && isSubmittingIdentity(value)) ||
    (value["state"] === "submitted" &&
      value["route"] === undefined &&
      value["writeOnceSlots"] === undefined &&
      value["senderAddress"] === undefined &&
      value["nonce"] === undefined &&
      typeof value["transactionHash"] === "string" &&
      isNonZeroStarkFieldElement(value["transactionHash"]) &&
      isBlockNumberOrAbsent(value["acceptedBlock"])));

const sameScope = (entry: StoredMaturity, scope: Strk20MaturityScope): boolean =>
  entry.accountId === scope.accountId &&
  entry.networkId === scope.networkId &&
  sameFelt(entry.poolAddress, scope.poolAddress);

const readAll = async (store: KeyValueStore): Promise<readonly StoredMaturity[]> => {
  const value = await store.get(STORE_KEY);
  return Array.isArray(value) ? value.filter(isStoredMaturity) : [];
};

const readScope = async (
  store: KeyValueStore,
  scope: Strk20MaturityScope,
): Promise<Strk20MaturityRecord | null> => {
  const entry = (await readAll(store)).find((candidate) => sameScope(candidate, scope));
  if (!entry) {
    return null;
  }
  if (entry.state === "submitting") {
    return entry.transactionHash === undefined
      ? {
          ...(entry.route === undefined ? {} : { route: entry.route }),
          ...(entry.writeOnceSlots === undefined
            ? {}
            : { writeOnceSlots: [...entry.writeOnceSlots] }),
          state: "submitting",
        }
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
};

// Evicts the oldest `submitted` records past MAX_RECORDS, never a
// `submitting` marker: dropping one would read as a clean scope and reopen
// proving while an earlier write may still land.
const bounded = (entries: readonly StoredMaturity[]): readonly StoredMaturity[] => {
  let excess = entries.length - MAX_RECORDS;
  return excess <= 0
    ? entries
    : entries.filter((entry) => entry.state === "submitting" || excess-- <= 0);
};

const writeScope = async (
  store: KeyValueStore,
  scope: Strk20MaturityScope,
  record: Strk20MaturityRecord | null,
): Promise<void> => {
  const retained = (await readAll(store)).filter((entry) => !sameScope(entry, scope));
  const next = record ? [...retained, { ...scope, ...record }] : retained;
  await store.set(STORE_KEY, [...bounded(next)]);
};

const clearIf = async (
  store: KeyValueStore,
  scope: Strk20MaturityScope,
  matches: (record: Strk20MaturityRecord | null) => boolean,
): Promise<boolean> => {
  if (!matches(await readScope(store, scope))) {
    return false;
  }
  await writeScope(store, scope, null);
  return true;
};

// Builds before v0.10.7 kept markers in session storage. Each one still held
// there is carried over for a scope the durable store has no marker for, then
// the session copy is removed, so the browser restart that used to clear it
// can no longer drop a write that may still land.
const carryLegacyMarkers = async (store: KeyValueStore, legacy: KeyValueStore): Promise<void> => {
  const carried = await readAll(legacy);
  if (carried.length > 0) {
    const current = await readAll(store);
    const missing = carried.filter((entry) => !current.some((kept) => sameScope(kept, entry)));
    if (missing.length > 0) {
      await store.set(STORE_KEY, [...bounded([...current, ...missing])]);
    }
  }
  await legacy.remove(STORE_KEY);
};

/**
 * Creates the durable maturity store over `store` (the extension's local
 * storage in production). When `legacy` (the session storage earlier builds
 * used) is given, its markers are carried over before any operation runs:
 * every call, `read` included, waits for that, so no read can miss a marker
 * still held in session storage. A failed carry rejects every call, so the
 * privacy runtime fails closed rather than proving over an unread marker.
 *
 * `read` stays outside the mutation queue. The conditional updates do not:
 * each comparison and its write are one queued mutation, so a resolution that
 * observed an older marker cannot overwrite a newer send that queued first.
 */
export const createStrk20MaturityStore = (
  store: KeyValueStore,
  legacy?: KeyValueStore,
): Strk20MaturityStore => {
  const ready = legacy ? carryLegacyMarkers(store, legacy) : Promise.resolve();
  // Kept handled so an early failure is not reported as unhandled; every
  // operation below still awaits `ready` and rethrows it.
  ready.catch(() => undefined);
  const serialized = serializeStoreMutations<Strk20MaturityStore>(
    {
      read(scope) {
        return readScope(store, scope);
      },
      async replaceIfCurrentHash(scope, transactionHash, record) {
        const current = await readScope(store, scope);
        if (!maturityRecordNamesHash(current, transactionHash)) {
          return false;
        }
        await writeScope(store, scope, record);
        return true;
      },
      releaseUnsigned(scope) {
        return clearIf(store, scope, isUnsignedAccountClaim);
      },
      releaseRelayClaim(scope, writeOnceSlots) {
        return clearIf(store, scope, (record) => isRelayClaimWithSlots(record, writeOnceSlots));
      },
      releaseSubmitting(scope) {
        return clearIf(store, scope, (record) => record?.state === "submitting");
      },
      write(scope, record) {
        return writeScope(store, scope, record);
      },
    },
    ["read"],
  );
  const afterCarry =
    <A extends readonly unknown[], R>(operation: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      await ready;
      return operation(...args);
    };
  return {
    read: afterCarry(serialized.read),
    releaseRelayClaim: afterCarry(serialized.releaseRelayClaim),
    releaseSubmitting: afterCarry(serialized.releaseSubmitting),
    releaseUnsigned: afterCarry(serialized.releaseUnsigned),
    replaceIfCurrentHash: afterCarry(serialized.replaceIfCurrentHash),
    write: afterCarry(serialized.write),
  };
};
