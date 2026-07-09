/**
 * Pure parsers for multisig runtime messages from extension pages. Every
 * field is validated structurally here; on-chain facts (signer membership,
 * proposal existence, class declaration) are re-checked by the ops handler,
 * and the multisig contract enforces them again at execution time.
 */
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import { isMultisigEntrypoint } from "../starknet/multisig";
import { isNonZeroStarkFieldElement, isStarkFieldElement } from "../starknet/networks";

const MAX_ID_LENGTH = 120;
const MAX_NAME_LENGTH = 48;
const MAX_SUMMARY_LENGTH = 120;
const MAX_CALLDATA_FELTS = 64;
const MAX_SIGNERS = 32;

const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;

const isOptionalName = (value: unknown): value is string | undefined =>
  value === undefined ||
  (typeof value === "string" && value.length > 0 && value.length <= MAX_NAME_LENGTH);

const isOptionalSummary = (value: unknown): value is string | undefined =>
  value === undefined || (typeof value === "string" && value.length <= MAX_SUMMARY_LENGTH);

const isOptionalSalt = (value: unknown): value is string | undefined =>
  value === undefined || (typeof value === "string" && isStarkFieldElement(value));

const isFeltList = (value: unknown, max: number): value is readonly string[] =>
  Array.isArray(value) &&
  value.length <= max &&
  value.every((felt) => typeof felt === "string" && isStarkFieldElement(felt));

/**
 * Parses a watch request that adds a multisig contract by address.
 */
export const readAddMultisigInput = (
  message: unknown,
): { readonly address: string; readonly name?: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["address", "name", "type"]) &&
  message.type === "wallet.addMultisig" &&
  typeof message.address === "string" &&
  isNonZeroStarkFieldElement(message.address) &&
  isOptionalName(message.name)
    ? { address: message.address, ...(message.name === undefined ? {} : { name: message.name }) }
    : null;

/**
 * Parses an id-only multisig request (`remove` and `refresh`).
 */
export const readMultisigIdInput = (
  message: unknown,
  type: "wallet.refreshMultisig" | "wallet.removeMultisig",
): { readonly id: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["id", "type"]) &&
  message.type === type &&
  isId(message.id)
    ? { id: message.id }
    : null;

/**
 * Parsed proposal submission: one inner call plus salt and summary.
 */
export type ProposeMultisigInput = {
  readonly calldata: readonly string[];
  readonly entrypoint: string;
  readonly multisigId: string;
  readonly salt: string;
  readonly summary?: string;
  readonly to: string;
};

/**
 * Parses a proposal submission for a watched multisig.
 */
export const readProposeMultisigInput = (message: unknown): ProposeMultisigInput | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, [
    "calldata",
    "entrypoint",
    "multisigId",
    "salt",
    "summary",
    "to",
    "type",
  ]) &&
  message.type === "wallet.proposeMultisigTx" &&
  isId(message.multisigId) &&
  typeof message.to === "string" &&
  isNonZeroStarkFieldElement(message.to) &&
  isMultisigEntrypoint(message.entrypoint) &&
  isFeltList(message.calldata, MAX_CALLDATA_FELTS) &&
  isOptionalSalt(message.salt) &&
  isOptionalSummary(message.summary)
    ? {
        calldata: message.calldata,
        entrypoint: message.entrypoint as string,
        multisigId: message.multisigId as string,
        salt: message.salt ?? "0x0",
        ...(message.summary === undefined ? {} : { summary: message.summary }),
        to: message.to,
      }
    : null;

/**
 * Parses a proposal action request (`confirm`, `revoke`, `execute`).
 */
export const readMultisigProposalActionInput = (
  message: unknown,
  type:
    | "wallet.confirmMultisigProposal"
    | "wallet.executeMultisigProposal"
    | "wallet.revokeMultisigConfirmation",
): { readonly proposalId: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["proposalId", "type"]) &&
  message.type === type &&
  isId(message.proposalId)
    ? { proposalId: message.proposalId }
    : null;

/**
 * Parses a track request for a proposal id shared out-of-band.
 */
export const readTrackMultisigProposalInput = (
  message: unknown,
): { readonly multisigId: string; readonly summary?: string; readonly txId: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["multisigId", "summary", "txId", "type"]) &&
  message.type === "wallet.trackMultisigProposal" &&
  isId(message.multisigId) &&
  typeof message.txId === "string" &&
  isStarkFieldElement(message.txId) &&
  isOptionalSummary(message.summary)
    ? {
        multisigId: message.multisigId as string,
        ...(message.summary === undefined ? {} : { summary: message.summary }),
        txId: message.txId,
      }
    : null;

/**
 * Parsed deploy request for a new multisig contract.
 */
export type DeployMultisigInput = {
  readonly name?: string;
  readonly quorum: number;
  readonly salt: string;
  readonly signers: readonly string[];
};

/**
 * Parses a deploy request. Signer uniqueness and quorum bounds are enforced
 * again by the deploy-call builder before anything is signed.
 */
export const readDeployMultisigInput = (message: unknown): DeployMultisigInput | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["name", "quorum", "salt", "signers", "type"]) &&
  message.type === "wallet.deployMultisig" &&
  Array.isArray(message.signers) &&
  message.signers.length >= 1 &&
  message.signers.length <= MAX_SIGNERS &&
  message.signers.every(
    (signer) => typeof signer === "string" && isNonZeroStarkFieldElement(signer),
  ) &&
  typeof message.quorum === "number" &&
  Number.isSafeInteger(message.quorum) &&
  message.quorum >= 1 &&
  message.quorum <= message.signers.length &&
  isOptionalSalt(message.salt) &&
  isOptionalName(message.name)
    ? {
        ...(message.name === undefined ? {} : { name: message.name }),
        quorum: message.quorum,
        salt: message.salt ?? "0x0",
        signers: message.signers as readonly string[],
      }
    : null;
