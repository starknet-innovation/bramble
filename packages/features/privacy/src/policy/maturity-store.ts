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
  isSameSubmitting,
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
    (value["state"] === "released" &&
      value["route"] === undefined &&
      value["senderAddress"] === undefined &&
      value["nonce"] === undefined &&
      value["transactionHash"] === undefined &&
      value["writeOnceSlots"] === undefined &&
      typeof value["acceptedBlock"] === "number" &&
      isBlockNumberOrAbsent(value["acceptedBlock"])) ||
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
  if (entry.state === "released") {
    return { acceptedBlock: entry.acceptedBlock, state: "released" };
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

// A `submitted` write that already has its receipt. Everything else still
// guards its scope: a `submitting` marker, a `submitted` write awaiting its
// receipt, or a `released` floor. Dropping a guard would read as a clean
// scope and reopen proving while an earlier write may still land, or before
// its state is past.
const isSettled = (
  entry: StoredMaturity,
): entry is StoredMaturity & { readonly state: "submitted"; readonly acceptedBlock: number } =>
  entry.state === "submitted" && entry.acceptedBlock !== undefined;

// Drops other scopes' settled rows past MAX_RECORDS, oldest acceptedBlock
// first (earlier in the list on a tie). `protectedIndex` is the row being
// written and is never dropped (#729): evicting it would read as a clean
// scope, so the next proof could skip the maturity wait. When that row is
// the only settled one, it stays and the list may exceed the cap.
const bounded = (
  entries: readonly StoredMaturity[],
  protectedIndex: number | null,
): readonly StoredMaturity[] => {
  const excess = entries.length - MAX_RECORDS;
  if (excess <= 0) {
    return entries;
  }
  const candidates: { readonly acceptedBlock: number; readonly index: number }[] = [];
  for (const [index, entry] of entries.entries()) {
    if (isSettled(entry) && index !== protectedIndex) {
      candidates.push({ acceptedBlock: entry.acceptedBlock, index });
    }
  }
  candidates.sort((left, right) => {
    if (left.acceptedBlock !== right.acceptedBlock) {
      return left.acceptedBlock < right.acceptedBlock ? -1 : 1;
    }
    return left.index - right.index;
  });
  const evict = new Set(candidates.slice(0, excess).map((candidate) => candidate.index));
  return evict.size === 0 ? entries : entries.filter((_, index) => !evict.has(index));
};

const writeScope = async (
  store: KeyValueStore,
  scope: Strk20MaturityScope,
  record: Strk20MaturityRecord | null,
): Promise<void> => {
  const retained = (await readAll(store)).filter((entry) => !sameScope(entry, scope));
  const next = record ? [...retained, { ...scope, ...record }] : retained;
  // The appended row is this write. Eviction may drop other scopes only.
  await store.set(STORE_KEY, [...bounded(next, record === null ? null : next.length - 1)]);
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

/**
 * Creates the durable maturity store over `store` (the extension's local
 * storage in production).
 *
 * Markers earlier builds kept in session storage are not carried over: the
 * browser clears that area when the extension updates, so none survives to
 * this build (mc-wallet 668 review). On Firefox, which has no
 * `storage.setAccessLevel`, local storage is also readable by the extension's
 * own content script; the marker is public metadata, but that script could
 * clear it.
 *
 * `read` stays outside the mutation queue. The conditional updates do not:
 * each comparison and its write are one queued mutation, so a resolution that
 * observed an older marker cannot overwrite a newer send that queued first.
 */
export const createStrk20MaturityStore = (store: KeyValueStore): Strk20MaturityStore =>
  serializeStoreMutations<Strk20MaturityStore>(
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
      async releaseRelayClaim(scope, writeOnceSlots, acceptedBlock) {
        if (!isRelayClaimWithSlots(await readScope(store, scope), writeOnceSlots)) {
          return false;
        }
        await writeScope(store, scope, { acceptedBlock, state: "released" });
        return true;
      },
      releaseSubmitting(scope, expected) {
        return clearIf(store, scope, (record) => isSameSubmitting(record, expected));
      },
      write(scope, record) {
        return writeScope(store, scope, record);
      },
    },
    ["read"],
  );
