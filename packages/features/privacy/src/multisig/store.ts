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
import { isMultisigStrk20RelayInvite, type MultisigStrk20RelayInvite } from "./relay-invite";

const STORE_KEY = "bramble:argent-multisig-strk20:v1";

type Shape = {
  readonly authorizations: readonly unknown[];
  readonly invites: readonly unknown[];
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
  readonly getInvite: (id: string) => Promise<MultisigStrk20RelayInvite | null>;
  readonly getProof: (intentId: string) => Promise<MultisigStrk20ProofRecord | null>;
  readonly getRelay: (id: string) => Promise<MultisigStrk20RelayRequest | null>;
  readonly listAuthorizations: (
    accountId: string,
    scalar: string,
  ) => Promise<readonly MultisigStrk20Authorization[]>;
  readonly listInvites: (accountId: string) => Promise<readonly MultisigStrk20RelayInvite[]>;
  readonly listRelays: (accountId: string) => Promise<readonly MultisigStrk20RelayRequest[]>;
  readonly putProof: (
    record: MultisigStrk20ProofRecord,
    liveIntentIds?: readonly string[],
    isAuthorized?: () => boolean,
  ) => Promise<"full" | "invalid" | "stored" | "unauthorized">;
  readonly upsertAuthorization: (
    record: MultisigStrk20Authorization,
    scalar: string,
    isAuthorized?: () => boolean,
  ) => Promise<"conflict" | "full" | "invalid" | "stored" | "unauthorized">;
  readonly upsertInvite: (
    record: MultisigStrk20RelayInvite,
    isAuthorized?: () => boolean,
  ) => Promise<"conflict" | "full" | "invalid" | "stored" | "unauthorized">;
  readonly upsertRelay: (
    record: MultisigStrk20RelayRequest,
    isAuthorized?: () => boolean,
  ) => Promise<"conflict" | "full" | "invalid" | "stored" | "unauthorized">;
};

const readShape = async (store: KeyValueStore): Promise<Shape> => {
  const stored = await store.get(STORE_KEY);
  if (!isRecord(stored)) return { authorizations: [], invites: [], proofs: [], relays: [] };
  return {
    authorizations: Array.isArray(stored["authorizations"]) ? stored["authorizations"] : [],
    invites: Array.isArray(stored["invites"]) ? stored["invites"] : [],
    proofs: Array.isArray(stored["proofs"]) ? stored["proofs"] : [],
    relays: Array.isArray(stored["relays"]) ? stored["relays"] : [],
  };
};

const writeShape = async (store: KeyValueStore, shape: Shape): Promise<void> => {
  const payload = JSON.parse(
    JSON.stringify({
      authorizations: [...shape.authorizations],
      invites: [...shape.invites],
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

const inviteConflicts = (
  current: MultisigStrk20RelayInvite,
  record: MultisigStrk20RelayInvite,
): boolean =>
  current.messageHash !== record.messageHash ||
  JSON.stringify(current.typedData) !== JSON.stringify(record.typedData) ||
  !keptFragments(current.fragments, record.fragments);

/**
 * Creates the multisig STRK20 store on an existing key-value store. Invalid
 * rows are dropped on read. A full collection drops the oldest row.
 */
export const createMultisigStrk20Store = (store: KeyValueStore): MultisigStrk20Store => {
  const write = (shape: Shape): Promise<void> =>
    writeShape(store, {
      authorizations: fit(shape.authorizations, MAX_MULTISIG_STRK20_AUTHORIZATIONS),
      // Proofs are capped in putProof so a live intent is never the row dropped.
      invites: fit(shape.invites, MAX_MULTISIG_STRK20_PROOFS),
      proofs: shape.proofs,
      relays: fit(shape.relays, MAX_MULTISIG_STRK20_PROOFS),
    });
  const proofId = (row: unknown): string | null =>
    isRecord(row) && typeof row["intentId"] === "string" ? row["intentId"] : null;
  const cappedProofs = (
    proofs: readonly unknown[],
    live: ReadonlySet<string>,
  ): readonly unknown[] | null => {
    if (proofs.length <= MAX_MULTISIG_STRK20_PROOFS) return proofs;
    const kept = proofs.filter((row) => {
      const id = proofId(row);
      return id !== null && live.has(id);
    });
    const droppable = proofs.filter((row) => !kept.includes(row));
    const room = MAX_MULTISIG_STRK20_PROOFS - kept.length;
    if (room < 0) return null;
    return [...droppable.slice(droppable.length - room), ...kept];
  };
  const commit = async (
    previous: Shape,
    next: Shape,
    isAuthorized: () => boolean,
  ): Promise<"stored" | "unauthorized"> => {
    if (!isAuthorized()) return "unauthorized";
    await write(next);
    if (isAuthorized()) return "stored";
    await write(previous);
    return "unauthorized";
  };
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
      async getInvite(id) {
        const shape = await readShape(store);
        const found = shape.invites.find((row) => isRecord(row) && row["id"] === id);
        return found && isMultisigStrk20RelayInvite(found) ? found : null;
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
      async listInvites(accountId) {
        const shape = await readShape(store);
        return shape.invites.filter(
          (row): row is MultisigStrk20RelayInvite =>
            isMultisigStrk20RelayInvite(row) && row.accountId === accountId,
        );
      },
      async listRelays(accountId) {
        const shape = await readShape(store);
        return shape.relays.filter(
          (row): row is MultisigStrk20RelayRequest =>
            isMultisigStrk20RelayRequest(row) &&
            row.accountId === accountId &&
            row.state !== "submitted",
        );
      },
      async listAuthorizations(accountId, scalar) {
        const shape = await readShape(store);
        return shape.authorizations.filter(
          (row): row is MultisigStrk20Authorization =>
            isMultisigStrk20Authorization(row, scalar) && row.accountId === accountId,
        );
      },
      async putProof(record, liveIntentIds = [], isAuthorized = () => true) {
        if (!isAuthorized()) return "unauthorized";
        if (!isMultisigStrk20ProofRecord(record)) return "invalid";
        const shape = await readShape(store);
        const next = [...shape.proofs.filter((row) => proofId(row) !== record.intentId), record];
        const proofs = cappedProofs(next, new Set([...liveIntentIds, record.intentId]));
        if (!proofs) return "full";
        return commit(shape, { ...shape, proofs }, isAuthorized);
      },
      async upsertAuthorization(record, scalar, isAuthorized = () => true) {
        if (!isAuthorized()) return "unauthorized";
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
        return commit(shape, { ...shape, authorizations }, isAuthorized);
      },
      async upsertInvite(record, isAuthorized = () => true) {
        if (!isAuthorized()) return "unauthorized";
        if (!isMultisigStrk20RelayInvite(record)) return "invalid";
        const shape = await readShape(store);
        const index = shape.invites.findIndex((row) => isRecord(row) && row["id"] === record.id);
        const current = index >= 0 ? shape.invites[index] : undefined;
        if (current && isMultisigStrk20RelayInvite(current) && inviteConflicts(current, record)) {
          return "conflict";
        }
        const invites = [...shape.invites];
        if (index >= 0) invites[index] = record;
        else invites.push(record);
        return commit(shape, { ...shape, invites }, isAuthorized);
      },
      async upsertRelay(record, isAuthorized = () => true) {
        if (!isAuthorized()) return "unauthorized";
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
        return commit(shape, { ...shape, relays }, isAuthorized);
      },
    },
    [
      "getAuthorization",
      "getInvite",
      "getProof",
      "getRelay",
      "listAuthorizations",
      "listInvites",
      "listRelays",
    ],
  );
};
