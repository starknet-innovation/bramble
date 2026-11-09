/**
 * Serialized local registry for stable Argent accounts, frozen V3 intents, and durable operation
 * claims. Invalid legacy OpenZeppelin records are ignored and can never become executable intents.
 */
import { isRecord } from "@bramble/core/json";
import type { KeyValueStore } from "@bramble/store/kv";
import { serializeStoreMutations } from "@bramble/store/mutation";
import { type AddressBookEntry, withAddressBookId } from "@bramble/wallet-model/preferences";
import { intentPlacement, isTerminalIntent } from "./intent-capacity";
import {
  type ArgentMultisigCurrentConfig,
  type ArgentMultisigOperationRecord,
  type ArgentMultisigRecord,
  type ArgentMultisigSigningIntent,
  canReplaceArgentMultisigSigningIntent,
  isArgentMultisigCurrentConfig,
  isArgentMultisigOperationRecord,
  isArgentMultisigRecord,
  isArgentMultisigSigningIntent,
} from "./repository-schema";

/**
 * Re-export persisted shapes from the pure validation module.
 */
export type {
  ArgentMultisigConfigSnapshot,
  ArgentMultisigCurrentConfig,
  ArgentMultisigIntentState,
  ArgentMultisigOperationRecord,
  ArgentMultisigRecord,
  ArgentMultisigSigningIntent,
} from "./repository-schema";

/**
 * Re-export deterministic ids and trust-boundary validators.
 */
export {
  argentMultisigIntentId,
  argentMultisigOperationId,
  canReplaceArgentMultisigSigningIntent,
  isArgentMultisigCurrentConfig,
  isArgentMultisigOperationRecord,
  isArgentMultisigRecord,
  isArgentMultisigSigningIntent,
} from "./repository-schema";

/** Marks an intent stale for a reason that never weakens a recorded one (mc-wallet 673). */
export { staleArgentMultisigIntent } from "./stale-intent";
/**
 * Re-export the local stale reason and outcome (mc-wallet 673).
 */
export type { ArgentMultisigStaleOutcome, ArgentMultisigStaleReason } from "./stale-reason";

/**
 * Browser storage key for the new Argent-only registry format.
 */
export const MULTISIG_STORE_KEY = "bramble:argent-multisigs:v2";

const MAX_MULTISIGS = 20;
const MAX_OPERATIONS = 100;

/**
 * Trusted-recipient projection of one watched shared account.
 */
export const multisigAddressBookEntry = (record: ArgentMultisigRecord): AddressBookEntry =>
  withAddressBookId({
    address: record.address,
    label: record.name ?? "Argent multisig",
    networkId: record.networkId,
  });

/**
 * Mutation outcome. Invalid and conflicting data is refused without writes.
 */
export type MultisigStoreWriteResult = "conflict" | "full" | "invalid" | "stored" | "unauthorized";

/**
 * Persistent registry API used by privileged background orchestration.
 */
export type MultisigStore = {
  readonly claimOperation: (
    record: ArgentMultisigOperationRecord,
  ) => Promise<"claimed" | "exists" | "full" | "invalid">;
  readonly getIntent: (id: string) => Promise<ArgentMultisigSigningIntent | null>;
  readonly getOperation: (id: string) => Promise<ArgentMultisigOperationRecord | null>;
  readonly listIntents: () => Promise<readonly ArgentMultisigSigningIntent[]>;
  readonly listMultisigs: () => Promise<readonly ArgentMultisigRecord[]>;
  readonly listOperations: () => Promise<readonly ArgentMultisigOperationRecord[]>;
  readonly recoverSigningClaims: () => Promise<number>;
  readonly releaseOperation: (id: string) => Promise<void>;
  readonly removeIntent: (
    id: string,
    isAuthorized?: () => boolean,
  ) => Promise<"missing" | "removed" | "unauthorized">;
  readonly removeMultisig: (
    id: string,
    isAuthorized?: () => boolean,
  ) => Promise<"removed" | "unauthorized">;
  readonly setOperationHash: (id: string, transactionHash: string) => Promise<void>;
  readonly updateCurrentConfig: (
    id: string,
    expected: ArgentMultisigCurrentConfig,
    next: ArgentMultisigCurrentConfig,
    isAuthorized?: () => boolean,
  ) => Promise<MultisigStoreWriteResult>;
  readonly upsertIntent: (
    record: ArgentMultisigSigningIntent,
    isAuthorized?: () => boolean,
  ) => Promise<MultisigStoreWriteResult>;
  readonly upsertMultisig: (
    record: ArgentMultisigRecord,
    isAuthorized?: () => boolean,
  ) => Promise<MultisigStoreWriteResult>;
  /**
   * `upsertMultisig` that never adds a record: a missing id is `invalid`. Reads
   * off the active-state lane enrich through it, so a late write cannot
   * re-create a record the user removed meanwhile (Sherlock 225).
   */
  readonly enrichMultisig: (
    record: ArgentMultisigRecord,
    isAuthorized?: () => boolean,
  ) => Promise<MultisigStoreWriteResult>;
};

type StoredShape = {
  readonly intents: readonly ArgentMultisigSigningIntent[];
  readonly multisigs: readonly ArgentMultisigRecord[];
  readonly operations: readonly ArgentMultisigOperationRecord[];
};

const EMPTY_SHAPE: StoredShape = { intents: [], multisigs: [], operations: [] };

const readShape = async (store: KeyValueStore): Promise<StoredShape> => {
  const stored = await store.get(MULTISIG_STORE_KEY);
  if (!isRecord(stored)) {
    return EMPTY_SHAPE;
  }
  const multisigs = Array.isArray(stored["multisigs"])
    ? stored["multisigs"].filter(isArgentMultisigRecord)
    : [];
  const accountIds = new Set(multisigs.map((record) => record.id));
  return {
    intents: Array.isArray(stored["intents"])
      ? stored["intents"]
          .filter(isArgentMultisigSigningIntent)
          .filter((intent) => accountIds.has(intent.accountId))
      : [],
    multisigs,
    operations: Array.isArray(stored["operations"])
      ? stored["operations"]
          .filter(isArgentMultisigOperationRecord)
          .filter((operation) => accountIds.has(operation.accountId))
      : [],
  };
};

const writeShape = async (store: KeyValueStore, shape: StoredShape): Promise<void> => {
  await store.set(MULTISIG_STORE_KEY, {
    intents: [...shape.intents],
    multisigs: [...shape.multisigs],
    operations: [...shape.operations],
  });
};

type ShapeMutation = {
  readonly result: MultisigStoreWriteResult;
  readonly shape: StoredShape;
};

const sameCurrentConfig = (
  left: ArgentMultisigCurrentConfig | undefined,
  right: ArgentMultisigCurrentConfig | undefined,
): boolean => {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.threshold === right.threshold &&
    left.signerPublicKeys.length === right.signerPublicKeys.length &&
    left.signerPublicKeys.every((key, index) => key === right.signerPublicKeys[index])
  );
};

const effectiveCurrentConfig = (
  record: ArgentMultisigRecord,
): ArgentMultisigCurrentConfig | undefined => record.currentConfig ?? record.deployment;

const upsertMultisigIn = (shape: StoredShape, record: ArgentMultisigRecord): ShapeMutation => {
  if (!isArgentMultisigRecord(record)) {
    return { result: "invalid", shape };
  }
  const existing = shape.multisigs.findIndex((stored) => stored.id === record.id);
  if (existing >= 0) {
    const current = shape.multisigs[existing];
    const incomingConfig = effectiveCurrentConfig(record);
    const enrichesAddressOnlyWatch =
      current !== undefined &&
      current.deployment === undefined &&
      effectiveCurrentConfig(current) === undefined &&
      incomingConfig !== undefined &&
      (record.currentConfig === undefined ||
        record.deployment === undefined ||
        sameCurrentConfig(record.currentConfig, record.deployment));
    if (
      !current ||
      current.accountContractType !== record.accountContractType ||
      current.address !== record.address ||
      current.classHash !== record.classHash ||
      current.networkId !== record.networkId ||
      (!enrichesAddressOnlyWatch &&
        (JSON.stringify(current.deployment) !== JSON.stringify(record.deployment) ||
          !sameCurrentConfig(effectiveCurrentConfig(current), effectiveCurrentConfig(record))))
    ) {
      return { result: "conflict", shape };
    }
    return {
      result: "stored",
      shape: {
        ...shape,
        multisigs: shape.multisigs.map((stored, index) =>
          index === existing && current?.name && record.name === undefined
            ? { ...record, name: current.name }
            : index === existing
              ? record
              : stored,
        ),
      },
    };
  }
  if (shape.multisigs.length >= MAX_MULTISIGS) {
    return { result: "full", shape };
  }
  return { result: "stored", shape: { ...shape, multisigs: [...shape.multisigs, record] } };
};

const updateCurrentConfigIn = (
  shape: StoredShape,
  id: string,
  expected: ArgentMultisigCurrentConfig,
  next: ArgentMultisigCurrentConfig,
): ShapeMutation => {
  if (!isArgentMultisigCurrentConfig(expected) || !isArgentMultisigCurrentConfig(next)) {
    return { result: "invalid", shape };
  }
  const index = shape.multisigs.findIndex((record) => record.id === id);
  const record = shape.multisigs[index];
  if (!record) {
    return { result: "invalid", shape };
  }
  if (!sameCurrentConfig(effectiveCurrentConfig(record), expected)) {
    return { result: "conflict", shape };
  }
  return {
    result: "stored",
    shape: {
      ...shape,
      multisigs: shape.multisigs.map((stored, current) =>
        current === index ? { ...stored, currentConfig: next } : stored,
      ),
    },
  };
};

const upsertIntentIn = (shape: StoredShape, record: ArgentMultisigSigningIntent): ShapeMutation => {
  if (
    !isArgentMultisigSigningIntent(record) ||
    !shape.multisigs.some((account) => account.id === record.accountId)
  ) {
    return { result: "invalid", shape };
  }
  const existing = shape.intents.findIndex((intent) => intent.id === record.id);
  if (existing >= 0) {
    const current = shape.intents[existing];
    if (!current || !canReplaceArgentMultisigSigningIntent(current, record)) {
      return { result: "conflict", shape };
    }
    return {
      result: "stored",
      shape: {
        ...shape,
        intents: shape.intents.map((intent, index) => (index === existing ? record : intent)),
      },
    };
  }
  const placement = intentPlacement(shape.intents, record.accountId);
  if (!placement.fits) return { result: "full", shape };
  const evicted = placement.evict === undefined ? undefined : shape.intents[placement.evict];
  return {
    result: "stored",
    shape: {
      ...shape,
      intents: [...shape.intents.filter((intent) => intent !== evicted), record],
      operations: evicted
        ? shape.operations.filter(
            (operation) => operation.target !== evicted.prepared.transactionHash,
          )
        : shape.operations,
    },
  };
};

const removeMultisigIn = (shape: StoredShape, id: string): StoredShape => ({
  intents: shape.intents.filter((intent) => intent.accountId !== id),
  multisigs: shape.multisigs.filter((record) => record.id !== id),
  operations: shape.operations.filter((operation) => operation.accountId !== id),
});

const claimOperationIn = (
  shape: StoredShape,
  record: ArgentMultisigOperationRecord,
): {
  readonly result: "claimed" | "exists" | "full" | "invalid";
  readonly shape: StoredShape;
} => {
  if (
    !isArgentMultisigOperationRecord(record) ||
    !shape.multisigs.some((account) => account.id === record.accountId)
  ) {
    return { result: "invalid", shape };
  }
  if (shape.operations.some((stored) => stored.id === record.id)) {
    return { result: "exists", shape };
  }
  if (shape.operations.length >= MAX_OPERATIONS) {
    const terminalTargets = new Set(
      shape.intents.filter(isTerminalIntent).map((intent) => intent.prepared.transactionHash),
    );
    const evict = shape.operations.findIndex((operation) => terminalTargets.has(operation.target));
    if (evict < 0) {
      return { result: "full", shape };
    }
    return {
      result: "claimed",
      shape: {
        ...shape,
        operations: [...shape.operations.filter((_, index) => index !== evict), record],
      },
    };
  }
  return {
    result: "claimed",
    shape: { ...shape, operations: [...shape.operations, record] },
  };
};

// Applies one record mutation under the caller's authorization, checked before
// the read, before the write and after it; a lost authorization rolls back.
const commitAuthorized = async (
  read: () => Promise<StoredShape>,
  write: (shape: StoredShape) => Promise<void>,
  isAuthorized: () => boolean,
  mutate: (shape: StoredShape) => ShapeMutation,
): Promise<MultisigStoreWriteResult> => {
  if (!isAuthorized()) return "unauthorized";
  const previous = await read();
  const mutation = mutate(previous);
  if (mutation.result !== "stored") return mutation.result;
  if (!isAuthorized()) return "unauthorized";
  await write(mutation.shape);
  if (isAuthorized()) return "stored";
  await write(previous);
  return "unauthorized";
};

const createStoreMethods = (
  read: () => Promise<StoredShape>,
  write: (shape: StoredShape) => Promise<void>,
): MultisigStore => ({
  async claimOperation(record) {
    const claim = claimOperationIn(await read(), record);
    if (claim.result === "claimed") {
      await write(claim.shape);
    }
    return claim.result;
  },
  async getIntent(id) {
    return (await read()).intents.find((record) => record.id === id) ?? null;
  },
  async getOperation(id) {
    return (await read()).operations.find((record) => record.id === id) ?? null;
  },
  async listIntents() {
    return [...(await read()).intents].reverse();
  },
  async listMultisigs() {
    return [...(await read()).multisigs].reverse();
  },
  async listOperations() {
    return [...(await read()).operations];
  },
  async recoverSigningClaims() {
    const shape = await read();
    const operations = shape.operations.filter((record) => record.kind !== "sign");
    const recovered = shape.operations.length - operations.length;
    if (recovered > 0) {
      await write({ ...shape, operations });
    }
    return recovered;
  },
  async releaseOperation(id) {
    const shape = await read();
    await write({
      ...shape,
      operations: shape.operations.filter((record) => record.id !== id),
    });
  },
  async removeIntent(id, isAuthorized = () => true) {
    if (!isAuthorized()) return "unauthorized";
    const previous = await read();
    const intent = previous.intents.find((record) => record.id === id);
    if (!intent) return "missing";
    if (!isAuthorized()) return "unauthorized";
    await write({
      ...previous,
      intents: previous.intents.filter((record) => record.id !== id),
      operations: previous.operations.filter(
        (record) => record.target !== intent.prepared.transactionHash,
      ),
    });
    if (isAuthorized()) return "removed";
    await write(previous);
    return "unauthorized";
  },
  async removeMultisig(id, isAuthorized = () => true) {
    if (!isAuthorized()) return "unauthorized";
    const previous = await read();
    const next = removeMultisigIn(previous, id);
    if (!isAuthorized()) return "unauthorized";
    await write(next);
    if (!isAuthorized()) {
      await write(previous);
      return "unauthorized";
    }
    return "removed";
  },
  async setOperationHash(id, transactionHash) {
    const shape = await read();
    const target = shape.operations.find((record) => record.id === id);
    if (!target) {
      return;
    }
    const updated = { ...target, transactionHash };
    if (!isArgentMultisigOperationRecord(updated)) {
      return;
    }
    await write({
      ...shape,
      operations: shape.operations.map((record) => (record.id === id ? updated : record)),
    });
  },
  async updateCurrentConfig(id, expected, next, isAuthorized = () => true) {
    return commitAuthorized(read, write, isAuthorized, (shape) =>
      updateCurrentConfigIn(shape, id, expected, next),
    );
  },
  async upsertIntent(record, isAuthorized = () => true) {
    return commitAuthorized(read, write, isAuthorized, (shape) => upsertIntentIn(shape, record));
  },
  async enrichMultisig(record, isAuthorized = () => true) {
    return commitAuthorized(read, write, isAuthorized, (shape) =>
      shape.multisigs.some((stored) => stored.id === record.id)
        ? upsertMultisigIn(shape, record)
        : { result: "invalid", shape },
    );
  },
  async upsertMultisig(record, isAuthorized = () => true) {
    return commitAuthorized(read, write, isAuthorized, (shape) => upsertMultisigIn(shape, record));
  },
});

/**
 * Creates the persistent, serialized Argent multisig registry.
 */
export const createMultisigStore = ({ store }: { readonly store: KeyValueStore }): MultisigStore =>
  serializeStoreMutations<MultisigStore>(
    createStoreMethods(
      () => readShape(store),
      (shape) => writeShape(store, shape),
    ),
    ["getIntent", "getOperation", "listIntents", "listMultisigs", "listOperations"],
  );

/**
 * Creates an isolated in-memory registry for tests and explicit fallback use.
 */
export const memoryMultisigStore = (): MultisigStore => {
  let shape = EMPTY_SHAPE;
  return serializeStoreMutations<MultisigStore>(
    createStoreMethods(
      async () => shape,
      async (next) => {
        shape = next;
      },
    ),
    ["getIntent", "getOperation", "listIntents", "listMultisigs", "listOperations"],
  );
};
