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
import {
  isMultisigStrk20RowFor,
  mergedMultisigStrk20Authorization,
  mergedMultisigStrk20Invite,
  multisigStrk20RelayConflicts,
  placeMultisigStrk20Row,
} from "./store-rows";

const STORE_KEY = "bramble:argent-multisig-strk20:v1";

type Shape = {
  readonly authorizations: readonly unknown[];
  readonly invites: readonly unknown[];
  readonly proofs: readonly unknown[];
  readonly relays: readonly unknown[];
  /** Multisig ids whose viewing key another holder has: shared, or received. */
  readonly sharedKeys: readonly unknown[];
};

type Upsert = "conflict" | "full" | "invalid" | "stored" | "unauthorized";

/**
 * Persistent multisig STRK20 round state. Mutations are serialized per store.
 */
export type MultisigStrk20Store = {
  readonly dropProof: (intentId: string) => Promise<void>;
  /** True while a relay for this multisig is collecting or ready to send. */
  readonly hasLiveRelay: (accountId: string) => Promise<boolean>;
  /** True once this multisig's viewing key was shared, or came from a co-owner. */
  readonly isKeyShared: (accountId: string) => Promise<boolean>;
  /** Records whether another holder has this multisig's viewing key. */
  readonly markKeyShared: (accountId: string, shared: boolean) => Promise<void>;
  /** Drops every row for a removed multisig, including its proof bytes. */
  readonly purgeAccount: (accountId: string) => Promise<void>;
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
  ) => Promise<Upsert>;
  readonly upsertInvite: (
    record: MultisigStrk20RelayInvite,
    isAuthorized?: () => boolean,
  ) => Promise<Upsert>;
  readonly upsertRelay: (
    record: MultisigStrk20RelayRequest,
    isAuthorized?: () => boolean,
  ) => Promise<Upsert>;
};

const list = (stored: Record<string, unknown>, key: string): readonly unknown[] => {
  const value = stored[key];
  return Array.isArray(value) ? value : [];
};

const readShape = async (store: KeyValueStore): Promise<Shape> => {
  const stored = await store.get(STORE_KEY);
  const row = isRecord(stored) ? stored : {};
  return {
    authorizations: list(row, "authorizations"),
    invites: list(row, "invites"),
    proofs: list(row, "proofs"),
    relays: list(row, "relays"),
    sharedKeys: list(row, "sharedKeys"),
  };
};

const writeShape = async (store: KeyValueStore, shape: Shape): Promise<void> => {
  const payload = JSON.parse(
    JSON.stringify({
      authorizations: [...shape.authorizations],
      invites: [...shape.invites],
      proofs: [...shape.proofs],
      relays: [...shape.relays],
      sharedKeys: [...shape.sharedKeys],
    }),
  ) as Json;
  await store.set(STORE_KEY, payload);
};

/**
 * Creates the multisig STRK20 store on an existing key-value store. Invalid
 * rows are dropped on read. Each collection is capped per multisig: a full
 * one makes room only from rows that are finished, and otherwise reports
 * `full` so the caller can retry later.
 */
export const createMultisigStrk20Store = (store: KeyValueStore): MultisigStrk20Store => {
  const write = (shape: Shape): Promise<void> => writeShape(store, shape);
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
        const current = shape.authorizations.find(
          (row) => isRecord(row) && row["id"] === record.id,
        );
        const merged =
          current && isMultisigStrk20Authorization(current, scalar)
            ? mergedMultisigStrk20Authorization(current, record)
            : record;
        if (!merged) return "conflict";
        // A ready round has been used to prove; a collecting one is still owed.
        const authorizations = placeMultisigStrk20Row(
          shape.authorizations,
          merged,
          MAX_MULTISIG_STRK20_AUTHORIZATIONS,
          (row) => !isMultisigStrk20Authorization(row, scalar) || row.state === "ready",
        );
        if (!authorizations) return "full";
        return commit(shape, { ...shape, authorizations }, isAuthorized);
      },
      async upsertInvite(record, isAuthorized = () => true) {
        if (!isAuthorized()) return "unauthorized";
        if (!isMultisigStrk20RelayInvite(record)) return "invalid";
        const shape = await readShape(store);
        const current = shape.invites.find((row) => isRecord(row) && row["id"] === record.id);
        const merged =
          current && isMultisigStrk20RelayInvite(current)
            ? mergedMultisigStrk20Invite(current, record)
            : record;
        if (!merged) return "conflict";
        const invites = placeMultisigStrk20Row(
          shape.invites,
          merged,
          MAX_MULTISIG_STRK20_PROOFS,
          (row) => !isMultisigStrk20RelayInvite(row) || row.fragments.length >= row.threshold,
        );
        if (!invites) return "full";
        return commit(shape, { ...shape, invites }, isAuthorized);
      },
      async upsertRelay(record, isAuthorized = () => true) {
        if (!isAuthorized()) return "unauthorized";
        if (!isMultisigStrk20RelayRequest(record)) return "invalid";
        const shape = await readShape(store);
        const current = shape.relays.find((row) => isRecord(row) && row["id"] === record.id);
        if (
          current &&
          isMultisigStrk20RelayRequest(current) &&
          multisigStrk20RelayConflicts(current, record)
        ) {
          return "conflict";
        }
        // A collecting or ready relay holds the only copy of its proof.
        const relays = placeMultisigStrk20Row(
          shape.relays,
          record,
          MAX_MULTISIG_STRK20_PROOFS,
          (row) => !isMultisigStrk20RelayRequest(row) || row.state === "submitted",
        );
        if (!relays) return "full";
        return commit(shape, { ...shape, relays }, isAuthorized);
      },
      async hasLiveRelay(accountId) {
        const shape = await readShape(store);
        return shape.relays.some(
          (row) =>
            isMultisigStrk20RelayRequest(row) &&
            row.accountId === accountId &&
            row.state !== "submitted",
        );
      },
      async isKeyShared(accountId) {
        return (await readShape(store)).sharedKeys.includes(accountId);
      },
      async markKeyShared(accountId, shared) {
        const shape = await readShape(store);
        const others = shape.sharedKeys.filter((id) => id !== accountId);
        await write({ ...shape, sharedKeys: shared ? [...others, accountId] : others });
      },
      async purgeAccount(accountId) {
        const shape = await readShape(store);
        const keep = (row: unknown): boolean => !isMultisigStrk20RowFor(row, accountId);
        await write({
          authorizations: shape.authorizations.filter(keep),
          invites: shape.invites.filter(keep),
          proofs: shape.proofs.filter(keep),
          relays: shape.relays.filter(keep),
          sharedKeys: shape.sharedKeys.filter((id) => id !== accountId),
        });
      },
    },
    [
      "getAuthorization",
      "getInvite",
      "getProof",
      "getRelay",
      "hasLiveRelay",
      "isKeyShared",
      "listAuthorizations",
      "listInvites",
      "listRelays",
    ],
  );
};
