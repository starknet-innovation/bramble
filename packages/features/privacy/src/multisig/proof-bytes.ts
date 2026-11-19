/**
 * Proof bytes of a multisig private action, kept under their own key. A
 * STARK proof is far larger than any key on the provider budget may be, so the
 * shared multisig row carries only a marker in place of the bytes, and the
 * bytes live under one key per intent or relay, on the one-proof budget.
 */
import { isRecord } from "@bramble/core/json";
import { assertStorageKey, type KeyValueStore, STRK20_PROOF_KEY_PREFIX } from "@bramble/store/kv";
import type { Strk20Proof } from "@bramble/wallet-protocol/strk20";

// Stands in for proof bytes kept under their own key.
const DETACHED_PROOF_DATA = "detached";

/** Whose proof a key holds: a frozen account intent, or a relay request. */
export type ProofBytesKind = "intent" | "relay";

/**
 * The key for one row's proof bytes. Ids are lowercased with `_` as `-` to
 * fit the storage key grammar; throws for an id that still does not fit.
 */
export const proofBytesKey = (kind: ProofBytesKind, id: string): string => {
  const key = `${STRK20_PROOF_KEY_PREFIX}${kind}:${id.toLowerCase().replaceAll("_", "-")}`;
  assertStorageKey(key);
  return key;
};

/** `row` with its proof bytes replaced by the marker. */
export const detachedProof = <T extends { readonly proof: Strk20Proof }>(row: T): T => ({
  ...row,
  proof: { ...row.proof, data: DETACHED_PROOF_DATA },
});

/** True when `row` carries the marker rather than its bytes. */
export const isDetachedProof = (row: { readonly proof: Strk20Proof }): boolean =>
  row.proof.data === DETACHED_PROOF_DATA;

/**
 * `row` with its bytes read back. A row written before bytes moved out is
 * returned as stored. Null when the bytes are missing.
 */
export const attachedProof = async <T extends { readonly proof: Strk20Proof }>(
  store: KeyValueStore,
  kind: ProofBytesKind,
  id: string,
  row: T,
): Promise<T | null> => {
  if (!isDetachedProof(row)) return row;
  const data = await store.get(proofBytesKey(kind, id));
  return typeof data === "string" && data.length > 0
    ? { ...row, proof: { ...row.proof, data } }
    : null;
};

/** Every proof-bytes key a stored shape still points at. */
export const referencedProofKeys = (shape: {
  readonly proofs: readonly unknown[];
  readonly relays: readonly unknown[];
}): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const row of shape.proofs) addReferencedKey(keys, "intent", row, "intentId");
  for (const row of shape.relays) addReferencedKey(keys, "relay", row, "id");
  return keys;
};

// Adds `row`'s proof-bytes key when the row carries the marker.
const addReferencedKey = (
  keys: Set<string>,
  kind: ProofBytesKind,
  row: unknown,
  idField: string,
): void => {
  if (!isRecord(row) || !isRecord(row["proof"])) return;
  const id = row[idField];
  if (row["proof"]["data"] !== DETACHED_PROOF_DATA || typeof id !== "string") return;
  try {
    keys.add(proofBytesKey(kind, id));
  } catch {
    // An id the grammar refuses never had bytes written for it.
  }
};
