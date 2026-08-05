/**
 * Local registry of watched multisig contracts and the proposals tracked for
 * them. Plain data kept outside the encrypted vault: addresses, signer sets,
 * quorums, and proposal calldata are all public on-chain state, and nothing
 * here authorizes anything by itself — every action against a multisig is
 * re-checked on-chain by the contract. Proposals submitted through this
 * wallet keep their inner call so execution can rebuild it; proposals tracked
 * from a pasted id have no call and can only be confirmed or revoked.
 */
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import { isMultisigCallInput, isMultisigEntrypoint, MULTISIG_LIMITS } from "../starknet/multisig";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "../starknet/networks";
import type { KeyValueStore } from "./kv";
import { serializeStoreMutations } from "./mutation-queue";

/**
 * Browser storage key for the multisig registry.
 */
export const MULTISIG_STORE_KEY = "mc-wallet:multisigs";

const MAX_MULTISIGS = 20;
const MAX_OPERATIONS = 100;
const MAX_PROPOSALS = 100;
const MAX_NAME_LENGTH = MULTISIG_LIMITS.nameLength;
const MAX_SUMMARY_LENGTH = MULTISIG_LIMITS.summaryLength;

/**
 * One watched multisig contract. `quorum` and `signers` are the last
 * on-chain snapshot and refresh whenever the detail screen loads.
 */
export type MultisigRecord = {
  readonly address: string;
  readonly id: string;
  readonly name?: string;
  readonly networkId: StarknetNetworkId;
  readonly quorum: number;
  readonly signers: readonly string[];
};

/**
 * Inner call kept for proposals submitted through this wallet so execution
 * can rebuild the exact (call, salt) pair the id was derived from.
 */
export type MultisigProposalCall = {
  readonly calldata: readonly string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
  readonly salt: string;
};

/**
 * One tracked proposal. `call` is null for proposals tracked from a pasted
 * transaction id. `state` and `confirmations` are last-known snapshots.
 * `submitTransactionHash` is present for proposals submitted by this wallet and
 * links the proposal to the activity row that proves the submit is still
 * unmined.
 */
export type MultisigProposalRecord = {
  readonly call: MultisigProposalCall | null;
  readonly confirmations: number;
  readonly confirmedBySigner?: boolean;
  readonly confirmedBySignerAddress?: string;
  /** Signers owned by this wallet whose confirmations were individually proved on-chain. */
  readonly confirmedSignerAddresses?: readonly string[];
  readonly id: string;
  readonly multisigId: string;
  readonly state: "confirmed" | "executed" | "not-found" | "pending";
  readonly submitTransactionHash?: string;
  readonly summary: string;
  readonly txId: string;
};

/**
 * Durable claim for a fee-paying multisig submission. Claims are public
 * bookkeeping only: they contain no signing material and never authorize a
 * transaction. A claim is written before broadcast so two extension surfaces
 * cannot submit the same fee-paying operation concurrently.
 */
export type MultisigOperationRecord = {
  readonly accountId: string;
  readonly id: string;
  readonly kind: "confirm" | "declare" | "deploy" | "execute" | "revoke";
  readonly networkId: StarknetNetworkId;
  readonly target: string;
  readonly transactionHash?: string;
};

/**
 * Multisig registry surface used by background message handling.
 */
export type MultisigStore = {
  readonly claimOperation: (
    record: MultisigOperationRecord,
  ) => Promise<"claimed" | "exists" | "full">;
  readonly getOperation: (id: string) => Promise<MultisigOperationRecord | null>;
  readonly listMultisigs: () => Promise<readonly MultisigRecord[]>;
  readonly listOperations: () => Promise<readonly MultisigOperationRecord[]>;
  readonly listProposals: () => Promise<readonly MultisigProposalRecord[]>;
  readonly releaseOperation: (id: string) => Promise<void>;
  readonly removeMultisig: (id: string) => Promise<void>;
  readonly setOperationHash: (id: string, transactionHash: string) => Promise<void>;
  readonly upsertMultisig: (record: MultisigRecord) => Promise<void>;
  readonly upsertProposal: (record: MultisigProposalRecord) => Promise<void>;
};

/**
 * Builds the deterministic id for a watched multisig from its network and
 * canonical address. Returns null when the address is not a felt.
 */
export const multisigId = (networkId: StarknetNetworkId, address: string): string | null => {
  const canonical = canonicalFelt(address);
  return canonical ? `${networkId}:${canonical}` : null;
};

/**
 * Builds the deterministic id for a tracked proposal.
 */
export const multisigProposalId = (ownerId: string, txId: string): string | null => {
  const canonical = canonicalFelt(txId);
  return canonical ? `${ownerId}:${canonical}` : null;
};

/**
 * Builds the deterministic key used to serialize one setup or proposal action.
 * Returns null for malformed account ids or targets.
 */
export const multisigOperationId = (
  kind: MultisigOperationRecord["kind"],
  networkId: StarknetNetworkId,
  accountId: string,
  target: string,
): string | null => {
  const canonical = canonicalFelt(target);
  return canonical && accountId.length > 0 && accountId.length <= 200
    ? `${kind}:${networkId}:${accountId}:${canonical}`
    : null;
};

const isName = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_NAME_LENGTH;

const isSummary = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_SUMMARY_LENGTH;

/**
 * Checks a stored multisig record before trusting it.
 */
export const isMultisigRecord = (value: unknown): value is MultisigRecord =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["address", "id", "name", "networkId", "quorum", "signers"]) &&
  typeof value["address"] === "string" &&
  isNonZeroStarkFieldElement(value["address"]) &&
  (value["name"] === undefined || isName(value["name"])) &&
  isStarknetNetworkId(value["networkId"]) &&
  typeof value["quorum"] === "number" &&
  Number.isSafeInteger(value["quorum"]) &&
  value["quorum"] >= 1 &&
  Array.isArray(value["signers"]) &&
  value["signers"].length >= value["quorum"] &&
  value["signers"].length <= MULTISIG_LIMITS.signers &&
  value["signers"].every(
    (signer) => typeof signer === "string" && isNonZeroStarkFieldElement(signer),
  ) &&
  value["id"] === multisigId(value["networkId"], value["address"]);

const isProposalCall = (value: unknown): value is MultisigProposalCall =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["calldata", "contractAddress", "entrypoint", "salt"]) &&
  Array.isArray(value["calldata"]) &&
  typeof value["contractAddress"] === "string" &&
  typeof value["entrypoint"] === "string" &&
  isMultisigEntrypoint(value["entrypoint"]) &&
  typeof value["salt"] === "string" &&
  isStarkFieldElement(value["salt"]) &&
  isMultisigCallInput({
    calldata: value["calldata"].filter((felt): felt is string => typeof felt === "string"),
    contractAddress: value["contractAddress"],
    entrypoint: value["entrypoint"],
  }) &&
  value["calldata"].every((felt) => typeof felt === "string");

/**
 * Checks a stored proposal record before trusting it.
 */
export const isMultisigProposalRecord = (value: unknown): value is MultisigProposalRecord =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "call",
    "confirmations",
    "confirmedBySigner",
    "confirmedBySignerAddress",
    "confirmedSignerAddresses",
    "id",
    "multisigId",
    "state",
    "submitTransactionHash",
    "summary",
    "txId",
  ]) &&
  (value["call"] === null || isProposalCall(value["call"])) &&
  typeof value["confirmations"] === "number" &&
  Number.isSafeInteger(value["confirmations"]) &&
  value["confirmations"] >= 0 &&
  (value["confirmedBySigner"] === undefined || typeof value["confirmedBySigner"] === "boolean") &&
  (value["confirmedBySignerAddress"] === undefined ||
    (typeof value["confirmedBySignerAddress"] === "string" &&
      isNonZeroStarkFieldElement(value["confirmedBySignerAddress"]))) &&
  (value["confirmedSignerAddresses"] === undefined ||
    (Array.isArray(value["confirmedSignerAddresses"]) &&
      value["confirmedSignerAddresses"].length <= MULTISIG_LIMITS.signers &&
      value["confirmedSignerAddresses"].every(
        (signer) => typeof signer === "string" && isNonZeroStarkFieldElement(signer),
      ) &&
      new Set(value["confirmedSignerAddresses"].map(canonicalFelt)).size ===
        value["confirmedSignerAddresses"].length)) &&
  (value["confirmedBySigner"] === undefined) ===
    (value["confirmedBySignerAddress"] === undefined) &&
  typeof value["multisigId"] === "string" &&
  (value["state"] === "confirmed" ||
    value["state"] === "executed" ||
    value["state"] === "not-found" ||
    value["state"] === "pending") &&
  (value["submitTransactionHash"] === undefined ||
    (typeof value["submitTransactionHash"] === "string" &&
      isStarkFieldElement(value["submitTransactionHash"]))) &&
  isSummary(value["summary"]) &&
  typeof value["txId"] === "string" &&
  isStarkFieldElement(value["txId"]) &&
  value["id"] === multisigProposalId(value["multisigId"], value["txId"]);

/**
 * Checks a stored in-flight operation before using it as a deduplication
 * claim. Unknown fields and malformed hashes are rejected at the storage
 * boundary.
 */
export const isMultisigOperationRecord = (value: unknown): value is MultisigOperationRecord =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "id", "kind", "networkId", "target", "transactionHash"]) &&
  typeof value["accountId"] === "string" &&
  (value["kind"] === "confirm" ||
    value["kind"] === "declare" ||
    value["kind"] === "deploy" ||
    value["kind"] === "execute" ||
    value["kind"] === "revoke") &&
  isStarknetNetworkId(value["networkId"]) &&
  typeof value["target"] === "string" &&
  isStarkFieldElement(value["target"]) &&
  (value["transactionHash"] === undefined ||
    (typeof value["transactionHash"] === "string" &&
      isStarkFieldElement(value["transactionHash"]))) &&
  value["id"] ===
    multisigOperationId(value["kind"], value["networkId"], value["accountId"], value["target"]);

type StoredShape = {
  readonly multisigs: readonly MultisigRecord[];
  readonly operations: readonly MultisigOperationRecord[];
  readonly proposals: readonly MultisigProposalRecord[];
};

const readShape = async (store: KeyValueStore): Promise<StoredShape> => {
  const stored = await store.get(MULTISIG_STORE_KEY);
  if (!isRecord(stored)) {
    return { multisigs: [], operations: [], proposals: [] };
  }
  const multisigs = Array.isArray(stored["multisigs"])
    ? stored["multisigs"].filter(isMultisigRecord)
    : [];
  const operations = Array.isArray(stored["operations"])
    ? stored["operations"].filter(isMultisigOperationRecord)
    : [];
  const ids = new Set(multisigs.map((record) => record.id));
  const proposals = Array.isArray(stored["proposals"])
    ? stored["proposals"]
        .filter(isMultisigProposalRecord)
        .filter((proposal) => ids.has(proposal.multisigId))
    : [];
  return { multisigs, operations, proposals };
};

const writeShape = async (store: KeyValueStore, shape: StoredShape): Promise<void> => {
  await store.set(MULTISIG_STORE_KEY, {
    multisigs: [...shape.multisigs],
    operations: [...shape.operations],
    proposals: [...shape.proposals],
  });
};

const upsertMultisigIn = (shape: StoredShape, record: MultisigRecord): StoredShape | null => {
  if (!isMultisigRecord(record)) {
    return null;
  }
  const existing = shape.multisigs.findIndex((stored) => stored.id === record.id);
  if (existing >= 0) {
    return {
      ...shape,
      multisigs: shape.multisigs.map((stored, index) => (index === existing ? record : stored)),
    };
  }
  return {
    ...shape,
    multisigs: [...shape.multisigs.slice(-(MAX_MULTISIGS - 1)), record],
  };
};

// Eviction priority at the proposal cap. Settled proposals go first, then
// tracked-by-id ones (their state is recoverable by re-tracking), and only
// as a last resort the oldest live proposal that carries a stored call —
// that call is the only copy able to execute it, so it must never be the
// silent first casualty.
const evictionRank = (proposal: MultisigProposalRecord): number => {
  if (proposal.state === "executed" || proposal.state === "not-found") {
    return 0;
  }
  return proposal.call === null ? 1 : 2;
};

// Enforces MAX_PROPOSALS, dropping oldest-first within each eviction rank.
const capProposals = (
  proposals: readonly MultisigProposalRecord[],
): readonly MultisigProposalRecord[] => {
  let excess = proposals.length - MAX_PROPOSALS;
  if (excess <= 0) {
    return proposals;
  }
  const kept = [...proposals];
  for (const rank of [0, 1, 2]) {
    for (let index = 0; index < kept.length && excess > 0; ) {
      const entry = kept[index];
      if (entry && evictionRank(entry) === rank) {
        kept.splice(index, 1);
        excess -= 1;
      } else {
        index += 1;
      }
    }
  }
  return kept;
};

const upsertProposalIn = (
  shape: StoredShape,
  record: MultisigProposalRecord,
): StoredShape | null => {
  if (
    !isMultisigProposalRecord(record) ||
    !shape.multisigs.some((m) => m.id === record.multisigId)
  ) {
    return null;
  }
  const kept = shape.proposals.filter((stored) => stored.id !== record.id);
  return { ...shape, proposals: [...capProposals([...kept, record])] };
};

const removeMultisigIn = (shape: StoredShape, id: string): StoredShape => ({
  multisigs: shape.multisigs.filter((stored) => stored.id !== id),
  operations: shape.operations,
  proposals: shape.proposals.filter((stored) => stored.multisigId !== id),
});

/**
 * Creates the persistent multisig registry.
 */
export const createMultisigStore = ({ store }: { readonly store: KeyValueStore }): MultisigStore =>
  serializeStoreMutations<MultisigStore>(
    {
      async claimOperation(record) {
        if (!isMultisigOperationRecord(record)) {
          return "exists";
        }
        const shape = await readShape(store);
        if (shape.operations.some((stored) => stored.id === record.id)) {
          return "exists";
        }
        if (shape.operations.length >= MAX_OPERATIONS) {
          return "full";
        }
        await writeShape(store, { ...shape, operations: [...shape.operations, record] });
        return "claimed";
      },
      async getOperation(id) {
        return (await readShape(store)).operations.find((record) => record.id === id) ?? null;
      },
      async listMultisigs() {
        return [...(await readShape(store)).multisigs].reverse();
      },
      async listOperations() {
        return [...(await readShape(store)).operations];
      },
      async listProposals() {
        return [...(await readShape(store)).proposals].reverse();
      },
      async releaseOperation(id) {
        const shape = await readShape(store);
        await writeShape(store, {
          ...shape,
          operations: shape.operations.filter((record) => record.id !== id),
        });
      },
      async removeMultisig(id) {
        await writeShape(store, removeMultisigIn(await readShape(store), id));
      },
      async setOperationHash(id, transactionHash) {
        if (!isStarkFieldElement(transactionHash)) {
          return;
        }
        const shape = await readShape(store);
        await writeShape(store, {
          ...shape,
          operations: shape.operations.map((record) =>
            record.id === id ? { ...record, transactionHash } : record,
          ),
        });
      },
      async upsertMultisig(record) {
        const next = upsertMultisigIn(await readShape(store), record);
        if (next) {
          await writeShape(store, next);
        }
      },
      async upsertProposal(record) {
        const next = upsertProposalIn(await readShape(store), record);
        if (next) {
          await writeShape(store, next);
        }
      },
    },
    ["getOperation", "listMultisigs", "listOperations", "listProposals"],
  );

/**
 * In-memory multisig registry used as the test and fallback default.
 */
export const memoryMultisigStore = (): MultisigStore => {
  let shape: StoredShape = { multisigs: [], operations: [], proposals: [] };
  return {
    async claimOperation(record) {
      if (
        !isMultisigOperationRecord(record) ||
        shape.operations.some((stored) => stored.id === record.id)
      ) {
        return "exists";
      }
      if (shape.operations.length >= MAX_OPERATIONS) {
        return "full";
      }
      shape = { ...shape, operations: [...shape.operations, record] };
      return "claimed";
    },
    async getOperation(id) {
      return shape.operations.find((record) => record.id === id) ?? null;
    },
    async listMultisigs() {
      return [...shape.multisigs].reverse();
    },
    async listOperations() {
      return [...shape.operations];
    },
    async listProposals() {
      return [...shape.proposals].reverse();
    },
    async releaseOperation(id) {
      shape = {
        ...shape,
        operations: shape.operations.filter((record) => record.id !== id),
      };
    },
    async removeMultisig(id) {
      shape = removeMultisigIn(shape, id);
    },
    async setOperationHash(id, transactionHash) {
      if (!isStarkFieldElement(transactionHash)) {
        return;
      }
      shape = {
        ...shape,
        operations: shape.operations.map((record) =>
          record.id === id ? { ...record, transactionHash } : record,
        ),
      };
    },
    async upsertMultisig(record) {
      shape = upsertMultisigIn(shape, record) ?? shape;
    },
    async upsertProposal(record) {
      shape = upsertProposalIn(shape, record) ?? shape;
    },
  };
};
