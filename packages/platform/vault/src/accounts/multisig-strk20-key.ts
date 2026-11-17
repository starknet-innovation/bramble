/**
 * Encrypted STRK20 viewing keys for Argent multisigs. One key is shared by
 * the co-owners of one multisig, for one chain and pool. It cannot spend.
 * Anyone who holds it can see that multisig's private activity, so it stays
 * inside the vault and leaves only inside a Nostr gift wrap.
 */

import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { isAccountId } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  isStarkPrivateKey,
  STARKNET_NETWORKS,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { isNostrApplicationData } from "@bramble/wallet-model/nostr";

/**
 * Provenance of a viewing key generated here and shared with co-owners.
 * Distinct from a software account's on-demand derivation and from the
 * Ledger ceremony scheme.
 */
export const MULTISIG_STRK20_VIEWING_KEY_SCHEME = "multisig-strk20-shared-v1";

/**
 * NIP-59 application identifier for a viewing-key gift wrap. Separate from
 * `bramble.multisig` so an intent parser never reads the key.
 */
export const MULTISIG_STRK20_KEY_IDENTIFIER = "bramble.multisig.strk20-viewing-key";

/** How many multisig/chain/pool keys one vault retains. */
export const MAX_MULTISIG_STRK20_VIEWING_KEYS = 32;

/**
 * One shared viewing key, bound to the multisig that will register it.
 * `viewingKey` is sensitive even though it cannot authorize a spend.
 */
export type MultisigStrk20ViewingKeyRef = {
  readonly chainId: string;
  readonly multisigId: string;
  readonly poolAddress: string;
  readonly scheme: typeof MULTISIG_STRK20_VIEWING_KEY_SCHEME;
  readonly viewingKey: string;
};

/**
 * A co-owner offered a different key for a scope this wallet already holds.
 * The foreign key is not retained. The mark exists so the wallet can say the
 * keys disagree without keeping the other secret.
 */
export type MultisigStrk20KeyConflict = {
  readonly chainId: string;
  readonly multisigId: string;
  readonly poolAddress: string;
};

/** Whether this wallet holds the shared key for one scope. */
export type MultisigStrk20KeyState = "absent" | "conflict" | "held";

/** What accepting one offered key did. An identical offer is `held`. */
export type MultisigStrk20KeyAccept = "conflict" | "held" | "stored";

/** Chain, pool, and multisig a viewing key is bound to. */
export type MultisigStrk20KeyScope = {
  readonly chainId: string;
  readonly multisigId: string;
  readonly poolAddress: string;
};

/** A vault request for one multisig viewing-key scope. */
export type MultisigStrk20KeyRequest = MultisigStrk20KeyScope & {
  readonly vaultPassphrase: string;
};

/**
 * The unlock session a key write must still be inside when its commit starts.
 * A lock during generation or encryption abandons the write.
 */
export type MultisigStrk20KeyAuthorization = {
  readonly isAuthorized: () => boolean;
};

/** Drops every key and conflict mark for one multisig, whatever the pool. */
export type MultisigStrk20KeyRemoval = MultisigStrk20KeyAuthorization & {
  readonly multisigId: string;
  readonly vaultPassphrase: string;
};

/** An offered viewing key, still inside the vault boundary. */
export type MultisigStrk20KeyOffer = MultisigStrk20KeyRequest & {
  readonly key: string;
};

/**
 * A decrypted gift-wrap payload. `key` is the viewing key; callers pass it
 * straight back into the vault and do not put it on a message.
 */
export type MultisigStrk20KeyPackage = MultisigStrk20KeyScope & {
  readonly key: string;
};

/** The vault's viewing-key collections, kept together so a write stays atomic. */
export type MultisigStrk20KeyLedger = {
  readonly conflicts: readonly MultisigStrk20KeyConflict[];
  readonly keys: readonly MultisigStrk20ViewingKeyRef[];
};

const scopeId = (scope: MultisigStrk20KeyScope): string =>
  `${scope.multisigId}:${scope.chainId}:${scope.poolAddress}`;

const sameScope = (left: MultisigStrk20KeyScope, right: MultisigStrk20KeyScope): boolean =>
  left.multisigId === right.multisigId &&
  sameFelt(left.chainId, right.chainId) &&
  sameFelt(left.poolAddress, right.poolAddress);

const chainMatchesMultisig = (multisigId: string, chainId: string): boolean => {
  const networkId = multisigId.slice(0, multisigId.indexOf(":"));
  return (
    isStarknetNetworkId(networkId) &&
    isAccountId(multisigId) &&
    sameFelt(chainId, STARKNET_NETWORKS[networkId].chainId)
  );
};

const isCanonicalNonZeroFelt = (value: unknown): value is string =>
  typeof value === "string" && isNonZeroStarkFieldElement(value) && canonicalFelt(value) === value;

const isCanonicalPrivateKey = (value: unknown): value is string =>
  typeof value === "string" && isStarkPrivateKey(value) && canonicalFelt(value) === value;

/**
 * Canonicalizes one requested scope. Returns null when the multisig id, chain,
 * or pool is not a canonical non-zero felt bound to that multisig's network.
 */
export const canonicalMultisigStrk20Scope = (
  multisigId: string,
  chainIdInput: string,
  poolAddressInput: string,
): MultisigStrk20KeyScope | null => {
  const chainId = canonicalFelt(chainIdInput);
  const poolAddress = canonicalFelt(poolAddressInput);
  if (
    !isAccountId(multisigId) ||
    chainId === null ||
    poolAddress === null ||
    !isNonZeroStarkFieldElement(chainId) ||
    !isNonZeroStarkFieldElement(poolAddress) ||
    !chainMatchesMultisig(multisigId, chainId)
  ) {
    return null;
  }
  return { chainId, multisigId, poolAddress };
};

const isScopeRecord = (value: unknown): value is MultisigStrk20KeyScope =>
  isRecord(value) &&
  typeof value["multisigId"] === "string" &&
  isCanonicalNonZeroFelt(value["chainId"]) &&
  isCanonicalNonZeroFelt(value["poolAddress"]) &&
  canonicalMultisigStrk20Scope(value["multisigId"], value["chainId"], value["poolAddress"]) !==
    null &&
  value["multisigId"] ===
    canonicalMultisigStrk20Scope(value["multisigId"], value["chainId"], value["poolAddress"])
      ?.multisigId;

const isKeyRef = (value: unknown): value is MultisigStrk20ViewingKeyRef => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["chainId", "multisigId", "poolAddress", "scheme", "viewingKey"]) ||
    value["scheme"] !== MULTISIG_STRK20_VIEWING_KEY_SCHEME ||
    !isCanonicalPrivateKey(value["viewingKey"]) ||
    typeof value["multisigId"] !== "string" ||
    typeof value["chainId"] !== "string" ||
    typeof value["poolAddress"] !== "string"
  ) {
    return false;
  }
  const scope = canonicalMultisigStrk20Scope(
    value["multisigId"],
    value["chainId"],
    value["poolAddress"],
  );
  return (
    scope !== null &&
    scope.multisigId === value["multisigId"] &&
    scope.chainId === value["chainId"] &&
    scope.poolAddress === value["poolAddress"]
  );
};

const isConflict = (value: unknown): value is MultisigStrk20KeyConflict =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["chainId", "multisigId", "poolAddress"]) &&
  isScopeRecord(value);

const sortedUnique = (ids: readonly string[]): boolean =>
  ids.every((id, index) => {
    if (index === 0) return true;
    const previous = ids[index - 1];
    return previous !== undefined && previous < id;
  });

const byScope = (left: MultisigStrk20KeyScope, right: MultisigStrk20KeyScope): number =>
  scopeId(left) < scopeId(right) ? -1 : scopeId(left) > scopeId(right) ? 1 : 0;

/**
 * Validates the vault's viewing-key collections. A conflict may exist only for
 * a key this vault still holds, scopes are unique, and both lists are sorted
 * so two writes of the same facts compare equal.
 */
export const hasValidMultisigStrk20VaultData = (keys: unknown, conflicts: unknown): boolean => {
  if (
    !Array.isArray(keys) ||
    !Array.isArray(conflicts) ||
    keys.length > MAX_MULTISIG_STRK20_VIEWING_KEYS ||
    conflicts.length > MAX_MULTISIG_STRK20_VIEWING_KEYS ||
    !keys.every(isKeyRef) ||
    !conflicts.every(isConflict)
  ) {
    return false;
  }
  const keyIds = keys.map((key) => scopeId(key));
  const conflictIds = conflicts.map((conflict) => scopeId(conflict));
  return (
    sortedUnique(keyIds) &&
    sortedUnique(conflictIds) &&
    conflictIds.every((id) => keyIds.includes(id))
  );
};

/**
 * Reports whether the scope is absent, held, or in conflict with an offer
 * this wallet refused. Returns null when the scope itself is invalid.
 */
export const multisigStrk20KeyState = (
  ledger: MultisigStrk20KeyLedger,
  scope: MultisigStrk20KeyScope,
): MultisigStrk20KeyState | null => {
  if (!canonicalMultisigStrk20Scope(scope.multisigId, scope.chainId, scope.poolAddress)) {
    return null;
  }
  if (ledger.conflicts.some((conflict) => sameScope(conflict, scope))) return "conflict";
  return ledger.keys.some((key) => sameScope(key, scope)) ? "held" : "absent";
};

/**
 * The stored key for one scope, or null. Stays inside the vault boundary.
 */
export const multisigStrk20ViewingKeyFor = (
  keys: readonly MultisigStrk20ViewingKeyRef[],
  scope: MultisigStrk20KeyScope,
): string | null => keys.find((key) => sameScope(key, scope))?.viewingKey ?? null;

/**
 * Stores an offered key. The first key for a scope wins. A different later
 * offer is marked as a conflict and does not replace the stored key. Returns
 * null when the record is invalid or a collection is already full.
 */
export const acceptMultisigStrk20Key = (
  ledger: MultisigStrk20KeyLedger,
  incoming: MultisigStrk20ViewingKeyRef,
): {
  readonly ledger: MultisigStrk20KeyLedger;
  readonly result: MultisigStrk20KeyAccept;
} | null => {
  if (!isKeyRef(incoming)) return null;
  const existing = ledger.keys.find((key) => sameScope(key, incoming));
  if (existing) {
    if (existing.viewingKey === incoming.viewingKey) {
      return { ledger, result: "held" };
    }
    if (ledger.conflicts.some((conflict) => sameScope(conflict, incoming))) {
      return { ledger, result: "conflict" };
    }
    if (ledger.conflicts.length === MAX_MULTISIG_STRK20_VIEWING_KEYS) return null;
    const conflicts = [
      ...ledger.conflicts,
      {
        chainId: incoming.chainId,
        multisigId: incoming.multisigId,
        poolAddress: incoming.poolAddress,
      },
    ].sort(byScope);
    return { ledger: { conflicts, keys: ledger.keys }, result: "conflict" };
  }
  if (ledger.keys.length === MAX_MULTISIG_STRK20_VIEWING_KEYS) return null;
  const keys = [...ledger.keys, incoming].sort(byScope);
  return { ledger: { conflicts: ledger.conflicts, keys }, result: "stored" };
};

/**
 * Drops every key and conflict mark for one multisig. Other multisigs are left
 * alone. Returns null when the id is not an account id.
 */
export const forgetMultisigStrk20Keys = (
  ledger: MultisigStrk20KeyLedger,
  multisigId: string,
): { readonly ledger: MultisigStrk20KeyLedger; readonly removed: boolean } | null => {
  if (!isAccountId(multisigId)) return null;
  const keys = ledger.keys.filter((key) => key.multisigId !== multisigId);
  const conflicts = ledger.conflicts.filter((conflict) => conflict.multisigId !== multisigId);
  return {
    ledger: { conflicts, keys },
    removed: keys.length !== ledger.keys.length || conflicts.length !== ledger.conflicts.length,
  };
};

/**
 * Drops this wallet's key and any conflict mark for one scope. Co-owners are
 * unaffected. Returns null when the scope is invalid.
 */
export const forgetMultisigStrk20Key = (
  ledger: MultisigStrk20KeyLedger,
  scope: MultisigStrk20KeyScope,
): { readonly ledger: MultisigStrk20KeyLedger; readonly removed: boolean } | null => {
  if (!canonicalMultisigStrk20Scope(scope.multisigId, scope.chainId, scope.poolAddress)) {
    return null;
  }
  const keys = ledger.keys.filter((key) => !sameScope(key, scope));
  const conflicts = ledger.conflicts.filter((conflict) => !sameScope(conflict, scope));
  return {
    ledger: { conflicts, keys },
    removed: keys.length !== ledger.keys.length || conflicts.length !== ledger.conflicts.length,
  };
};

/**
 * The gift-wrap plaintext for one stored key. Callers hand it to Krusty and
 * do not log it. Returns null when the payload would exceed the Nostr limit.
 */
export const multisigStrk20KeyPackageContent = (
  ref: MultisigStrk20ViewingKeyRef,
): string | null => {
  if (!isKeyRef(ref)) return null;
  const content = JSON.stringify({
    chainId: ref.chainId,
    multisigId: ref.multisigId,
    poolAddress: ref.poolAddress,
    version: 1,
    viewingKey: ref.viewingKey,
  });
  return isNostrApplicationData(content) ? content : null;
};

/**
 * Parses one decrypted gift wrap. Extra fields, a non-canonical key, and any
 * version other than 1 are refused. The key stays in the returned object.
 */
export const readMultisigStrk20KeyPackage = (content: string): MultisigStrk20KeyPackage | null => {
  if (!isNostrApplicationData(content)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (
    !isRecord(parsed) ||
    !hasOnlyKnownKeys(parsed, ["chainId", "multisigId", "poolAddress", "version", "viewingKey"]) ||
    parsed["version"] !== 1 ||
    typeof parsed["multisigId"] !== "string" ||
    typeof parsed["chainId"] !== "string" ||
    typeof parsed["poolAddress"] !== "string" ||
    !isCanonicalPrivateKey(parsed["viewingKey"])
  ) {
    return null;
  }
  const scope = canonicalMultisigStrk20Scope(
    parsed["multisigId"],
    parsed["chainId"],
    parsed["poolAddress"],
  );
  if (
    !scope ||
    scope.chainId !== parsed["chainId"] ||
    scope.poolAddress !== parsed["poolAddress"] ||
    scope.multisigId !== parsed["multisigId"]
  ) {
    return null;
  }
  return { ...scope, key: parsed["viewingKey"] };
};
