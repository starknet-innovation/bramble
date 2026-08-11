/**
 * Record shapes, deterministic ids, and storage-boundary validators for the
 * multisig registry.
 *
 * Split out of ./repository so the persistence layer and the shapes it
 * persists each stay readable and under the file limit. Everything here is
 * pure: the store reads untrusted browser storage and hands each candidate
 * record to these guards, which fail closed rather than repairing anything —
 * an id that does not re-derive from its own fields is not that record.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import {
  isMultisigCallInput,
  isMultisigEntrypoint,
  MULTISIG_LIMITS,
} from "@mc-wallet/multisig/chain";
import { isAccountId, isAccountIdForNetwork } from "@mc-wallet/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";

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
  /**
   * Watched multisig a proposal action belongs to. Absent on declare/deploy
   * claims, whose target is a class hash or an address rather than a proposal
   * id, and absent on proposal claims written before the namespace existed.
   */
  readonly multisigId?: string;
  readonly networkId: StarknetNetworkId;
  readonly target: string;
  readonly transactionHash?: string;
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
  return canonical && isAccountId(ownerId) ? `${ownerId}:${canonical}` : null;
};

/**
 * Builds the deterministic key used to serialize one setup or proposal action.
 * Returns null for malformed account ids, owners, or targets.
 *
 * `owningMultisigId` namespaces a proposal action by the contract it runs
 * against. OpenZeppelin transaction ids hash `(call, salt)` and not the
 * contract, so two watched multisigs holding the identical proposal share one
 * id — without this component their claims collide and an action on one wedges
 * the other. Omitted for declare/deploy claims, whose target is already a class
 * hash or an address, and for the legacy proposal claims written before this
 * component existed, which keep their original (unnamespaced) key so an
 * in-flight upgrade does not silently free a live claim.
 */
export const multisigOperationId = (
  kind: MultisigOperationRecord["kind"],
  networkId: StarknetNetworkId,
  accountId: string,
  target: string,
  owningMultisigId?: string,
): string | null => {
  const canonical = canonicalFelt(target);
  if (!canonical || !isAccountIdForNetwork(accountId, networkId)) {
    return null;
  }
  if (owningMultisigId === undefined) {
    return `${kind}:${networkId}:${accountId}:${canonical}`;
  }
  return isAccountIdForNetwork(owningMultisigId, networkId)
    ? `${kind}:${networkId}:${accountId}:${owningMultisigId}:${canonical}`
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
  isAccountId(value["multisigId"]) &&
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

// Reads the owning multisig for the id re-derivation. Anything that is not a
// string reads as absent, and the clause in the validator independently rejects
// such a record, so a malformed owner can never be re-derived into a valid key.
const storedOwningMultisigId = (value: Record<string, unknown>): string | undefined => {
  const owner = value["multisigId"];
  return typeof owner === "string" ? owner : undefined;
};

/**
 * Checks a stored in-flight operation before using it as a deduplication
 * claim. Unknown fields and malformed hashes are rejected at the storage
 * boundary.
 */
export const isMultisigOperationRecord = (value: unknown): value is MultisigOperationRecord =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "accountId",
    "id",
    "kind",
    "multisigId",
    "networkId",
    "target",
    "transactionHash",
  ]) &&
  (value["kind"] === "confirm" ||
    value["kind"] === "declare" ||
    value["kind"] === "deploy" ||
    value["kind"] === "execute" ||
    value["kind"] === "revoke") &&
  isStarknetNetworkId(value["networkId"]) &&
  isAccountIdForNetwork(value["accountId"], value["networkId"]) &&
  // A declare/deploy target is a class hash or a contract address, so an owning
  // multisig would be meaningless there; only proposal actions carry one.
  (value["multisigId"] === undefined ||
    (value["kind"] !== "declare" &&
      value["kind"] !== "deploy" &&
      isAccountIdForNetwork(value["multisigId"], value["networkId"]))) &&
  typeof value["target"] === "string" &&
  isStarkFieldElement(value["target"]) &&
  (value["transactionHash"] === undefined ||
    (typeof value["transactionHash"] === "string" &&
      isStarkFieldElement(value["transactionHash"]))) &&
  value["id"] ===
    multisigOperationId(
      value["kind"],
      value["networkId"],
      value["accountId"],
      value["target"],
      storedOwningMultisigId(value),
    );
