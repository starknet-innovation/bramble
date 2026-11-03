/**
 * Local storage for multisig STRK20 authorizations, proof bytes, and relay
 * requests. Authorizations are re-checked against the shared scalar on read,
 * so a tampered call list cannot be signed. Proof bytes never go into a
 * Nostr package; they live only under this key.
 */

import { isRecord, type Json } from "@bramble/core/json";
import type { KeyValueStore } from "@bramble/store/kv";
import { serializeStoreMutations } from "@bramble/store/mutation";
import {
  isMultisigStrk20Authorization,
  isMultisigStrk20ProofRecord,
  isMultisigStrk20RelayRequest,
  MAX_MULTISIG_STRK20_AUTHORIZATIONS,
  MAX_MULTISIG_STRK20_PROOFS,
  type MultisigStrk20Authorization,
  type MultisigStrk20ProofRecord,
  type MultisigStrk20RelayRequest,
} from "./records";

const STORE_KEY = "bramble:argent-multisig-strk20:v1";

type Shape = {
  readonly authorizations: readonly unknown[];
  readonly proofs: readonly unknown[];
  readonly relays: readonly unknown[];
};

/**
 * Persistent multisig STRK20 round state. Mutations are serialized per store.
 */
export type MultisigStrk20Store = {
  readonly dropProof: (intentId: string) => Promise<void>;
  readonly getAuthorization: (
    id: string,
    scalar: string,
  ) => Promise<MultisigStrk20Authorization | null>;
  readonly getProof: (intentId: string) => Promise<MultisigStrk20ProofRecord | null>;
  readonly getRelay: (id: string) => Promise<MultisigStrk20RelayRequest | null>;
  readonly listAuthorizations: (
    accountId: string,
    scalar: string,
  ) => Promise<readonly MultisigStrk20Authorization[]>;
  readonly putProof: (record: MultisigStrk20ProofRecord) => Promise<"invalid" | "stored">;
  readonly upsertAuthorization: (
    record: MultisigStrk20Authorization,
    scalar: string,
  ) => Promise<"conflict" | "full" | "invalid" | "stored">;
  readonly upsertRelay: (
    record: MultisigStrk20RelayRequest,
  ) => Promise<"conflict" | "full" | "invalid" | "stored">;
};

const readShape = async (store: KeyValueStore): Promise<Shape> => {
  const stored = await store.get(STORE_KEY);
  if (!isRecord(stored)) return { authorizations: [], proofs: [], relays: [] };
  return {
    authorizations: Array.isArray(stored["authorizations"]) ? stored["authorizations"] : [],
    proofs: Array.isArray(stored["proofs"]) ? stored["proofs"] : [],
    relays: Array.isArray(stored["relays"]) ? stored["relays"] : [],
  };
};

const writeShape = async (store: KeyValueStore, shape: Shape): Promise<void> => {
  const payload = JSON.parse(
    JSON.stringify({
      authorizations: [...shape.authorizations],
      proofs: [...shape.proofs],
      relays: [...shape.relays],
    }),
  ) as Json;
  await store.set(STORE_KEY, payload);
};

const fit = (values: readonly unknown[], max: number): readonly unknown[] =>
  values.length > max ? values.slice(values.length - max) : values;

const keptFragments = (
  current: readonly { readonly publicKey: string }[],
  next: readonly { readonly publicKey: string }[],
): boolean =>
  current.every((fragment) => next.some((item) => item.publicKey === fragment.publicKey));

const authorizationConflicts = (
  current: MultisigStrk20Authorization,
  record: MultisigStrk20Authorization,
): boolean =>
  current.summary !== record.summary ||
  current.hash !== record.hash ||
  JSON.stringify(current.calls) !== JSON.stringify(record.calls) ||
  !keptFragments(current.fragments, record.fragments);

const relayConflicts = (
  current: MultisigStrk20RelayRequest,
  record: MultisigStrk20RelayRequest,
): boolean =>
  current.proof.data !== record.proof.data || !keptFragments(current.fragments, record.fragments);

/**
 * Creates the multisig STRK20 store on an existing key-value store. Invalid
 * rows are dropped on read. A full collection drops the oldest row.
 */
export const createMultisigStrk20Store = (store: KeyValueStore): MultisigStrk20Store => {
  const write = (shape: Shape): Promise<void> =>
    writeShape(store, {
      authorizations: fit(shape.authorizations, MAX_MULTISIG_STRK20_AUTHORIZATIONS),
      proofs: fit(shape.proofs, MAX_MULTISIG_STRK20_PROOFS),
      relays: fit(shape.relays, MAX_MULTISIG_STRK20_PROOFS),
    });
  return serializeStoreMutations(
    {
      async dropProof(intentId) {
        const shape = await readShape(store);
        await write({
          ...shape,
          proofs: shape.proofs.filter((row) => !isRecord(row) || row["intentId"] !== intentId),
        });
      },
      async getAuthorization(id, scalar) {
        const shape = await readShape(store);
        const found = shape.authorizations.find((row) => isRecord(row) && row["id"] === id);
        return found && isMultisigStrk20Authorization(found, scalar) ? found : null;
      },
      async getProof(intentId) {
        const shape = await readShape(store);
        const found = shape.proofs.find((row) => isRecord(row) && row["intentId"] === intentId);
        return found && isMultisigStrk20ProofRecord(found) ? found : null;
      },
      async getRelay(id) {
        const shape = await readShape(store);
        const found = shape.relays.find((row) => isRecord(row) && row["id"] === id);
        return found && isMultisigStrk20RelayRequest(found) ? found : null;
      },
      async listAuthorizations(accountId, scalar) {
        const shape = await readShape(store);
        return shape.authorizations.filter(
          (row): row is MultisigStrk20Authorization =>
            isMultisigStrk20Authorization(row, scalar) && row.accountId === accountId,
        );
      },
      async putProof(record) {
        if (!isMultisigStrk20ProofRecord(record)) return "invalid";
        const shape = await readShape(store);
        const next = shape.proofs.filter(
          (row) => !isRecord(row) || row["intentId"] !== record.intentId,
        );
        await write({ ...shape, proofs: [...next, record] });
        return "stored";
      },
      async upsertAuthorization(record, scalar) {
        if (!isMultisigStrk20Authorization(record, scalar)) return "invalid";
        const shape = await readShape(store);
        const index = shape.authorizations.findIndex(
          (row) => isRecord(row) && row["id"] === record.id,
        );
        const current = index >= 0 ? shape.authorizations[index] : undefined;
        if (
          current &&
          isMultisigStrk20Authorization(current, scalar) &&
          authorizationConflicts(current, record)
        ) {
          return "conflict";
        }
        const authorizations = [...shape.authorizations];
        if (index >= 0) authorizations[index] = record;
        else authorizations.push(record);
        await write({ ...shape, authorizations });
        return "stored";
      },
      async upsertRelay(record) {
        if (!isMultisigStrk20RelayRequest(record)) return "invalid";
        const shape = await readShape(store);
        const index = shape.relays.findIndex((row) => isRecord(row) && row["id"] === record.id);
        const current = index >= 0 ? shape.relays[index] : undefined;
        if (current && isMultisigStrk20RelayRequest(current) && relayConflicts(current, record)) {
          return "conflict";
        }
        const relays = [...shape.relays];
        if (index >= 0) relays[index] = record;
        else relays.push(record);
        await write({ ...shape, relays });
        return "stored";
      },
    },
    ["getAuthorization", "getProof", "getRelay", "listAuthorizations"],
  );
};
