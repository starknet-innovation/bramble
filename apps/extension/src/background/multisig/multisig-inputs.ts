/**
 * Pure parsers for multisig runtime messages from extension pages. Every
 * field is validated structurally here; on-chain facts (signer membership,
 * proposal existence, class declaration) are re-checked by the ops handler,
 * and the multisig contract enforces them again at execution time.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { isAccountId } from "@mc-wallet/wallet-model/accounts";
import { isNonZeroStarkFieldElement, isStarkFieldElement } from "@mc-wallet/wallet-model/networks";
import {
  isMultisigConfirmationMode,
  type MultisigConfirmationMode,
} from "@mc-wallet/multisig/confirmation";
import {
  isMultisigCallInput,
  isMultisigEntrypoint,
  MULTISIG_LIMITS,
  type MultisigCallInput,
} from "@mc-wallet/multisig/chain";

// Stored ids compose `<networkId>:<address>:<txId>`; with full-length felts a
// proposal id runs to ~144 characters, so the cap must sit comfortably above.
const MAX_ID_LENGTH = 200;
const MAX_NAME_LENGTH = MULTISIG_LIMITS.nameLength;
const MAX_SUMMARY_LENGTH = MULTISIG_LIMITS.summaryLength;
const MAX_CALLDATA_FELTS = MULTISIG_LIMITS.calldataFelts;
const MAX_SIGNERS = MULTISIG_LIMITS.signers;

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
 * Public call details carried by an imported review package.
 */
export type TrackedMultisigCall = MultisigCallInput & { readonly salt: string };

const readTrackedCall = (value: unknown): TrackedMultisigCall | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["calldata", "contractAddress", "entrypoint", "salt"]) ||
    !Array.isArray(value["calldata"]) ||
    typeof value["contractAddress"] !== "string" ||
    typeof value["entrypoint"] !== "string" ||
    typeof value["salt"] !== "string" ||
    !isStarkFieldElement(value["salt"])
  ) {
    return null;
  }
  const call = {
    calldata: value["calldata"].filter((felt): felt is string => typeof felt === "string"),
    contractAddress: value["contractAddress"],
    entrypoint: value["entrypoint"],
  };
  return value["calldata"].length === call.calldata.length && isMultisigCallInput(call)
    ? { ...call, salt: value["salt"] }
    : null;
};

/**
 * Parses a watch request that adds a multisig contract by address.
 */
export const readAddMultisigInput = (
  message: unknown,
): { readonly address: string; readonly name?: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["address", "name", "type"]) &&
  message["type"] === "wallet.addMultisig" &&
  typeof message["address"] === "string" &&
  isNonZeroStarkFieldElement(message["address"]) &&
  isOptionalName(message["name"])
    ? {
        address: message["address"],
        ...(message["name"] === undefined ? {} : { name: message["name"] }),
      }
    : null;

/**
 * Parses an id-only multisig request (`balances`, `remove`, and `refresh`).
 */
export const readMultisigIdInput = (
  message: unknown,
  type: "wallet.multisigBalances" | "wallet.refreshMultisig" | "wallet.removeMultisig",
): { readonly id: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["id", "type"]) &&
  message["type"] === type &&
  isId(message["id"])
    ? { id: message["id"] }
    : null;

/**
 * Parsed proposal submission: one inner call plus salt and summary.
 */
export type ProposeMultisigInput = {
  readonly calldata: readonly string[];
  readonly entrypoint: string;
  readonly multisigId: string;
  readonly salt: string;
  readonly signerAccountId?: string;
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
    "signerAccountId",
    "summary",
    "to",
    "type",
  ]) &&
  message["type"] === "wallet.proposeMultisigTx" &&
  isId(message["multisigId"]) &&
  typeof message["to"] === "string" &&
  isNonZeroStarkFieldElement(message["to"]) &&
  isMultisigEntrypoint(message["entrypoint"]) &&
  isFeltList(message["calldata"], MAX_CALLDATA_FELTS) &&
  isOptionalSalt(message["salt"]) &&
  (message["signerAccountId"] === undefined || isAccountId(message["signerAccountId"])) &&
  isOptionalSummary(message["summary"])
    ? {
        calldata: message["calldata"],
        entrypoint: message["entrypoint"] as string,
        multisigId: message["multisigId"] as string,
        salt: message["salt"] ?? "0x0",
        ...(message["signerAccountId"] === undefined
          ? {}
          : { signerAccountId: message["signerAccountId"] }),
        ...(message["summary"] === undefined ? {} : { summary: message["summary"] }),
        to: message["to"],
      }
    : null;

/**
 * Parsed proposal action (`confirm`, `revoke`, `execute`). Confirm and revoke
 * on proposals tracked by id only must carry `untrackedVerified: true` after
 * the user acknowledges that off-chain summaries are not chain-verified.
 */
export type MultisigProposalActionInput = {
  readonly proposalId: string;
  readonly signerAccountId?: string;
  readonly untrackedVerified?: boolean;
};

/**
 * Parsed confirmation review/submission. The discriminated mode makes a bare
 * confirmation and an atomic confirmation-plus-execution impossible to mix up
 * after the untrusted message boundary.
 */
export type ConfirmMultisigProposalInput = MultisigProposalActionInput & {
  readonly mode: MultisigConfirmationMode;
};

/**
 * Parses a confirmation review or submission. Both operations carry the same
 * explicit mode so the fee shown in review is for the calls eventually sent.
 */
export const readConfirmMultisigProposalInput = (
  message: unknown,
  type: "wallet.confirmMultisigProposal" | "wallet.prepareMultisigConfirmation",
): ConfirmMultisigProposalInput | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, [
    "mode",
    "proposalId",
    "signerAccountId",
    "type",
    "untrackedVerified",
  ]) &&
  message["type"] === type &&
  isMultisigConfirmationMode(message["mode"]) &&
  isId(message["proposalId"]) &&
  (message["signerAccountId"] === undefined || isAccountId(message["signerAccountId"])) &&
  (message["untrackedVerified"] === undefined || message["untrackedVerified"] === true)
    ? {
        mode: message["mode"],
        proposalId: message["proposalId"],
        ...(message["signerAccountId"] === undefined
          ? {}
          : { signerAccountId: message["signerAccountId"] }),
        ...(message["untrackedVerified"] === true ? { untrackedVerified: true } : {}),
      }
    : null;

/**
 * Parses a revoke or execute request. Confirmation has its own discriminated
 * parser above because its mode changes the exact calls being authorized.
 */
export const readMultisigProposalActionInput = (
  message: unknown,
  type: "wallet.executeMultisigProposal" | "wallet.revokeMultisigConfirmation",
): MultisigProposalActionInput | null => {
  const keys =
    type === "wallet.executeMultisigProposal"
      ? (["proposalId", "signerAccountId", "type"] as const)
      : (["proposalId", "signerAccountId", "type", "untrackedVerified"] as const);
  if (
    !(
      isRecord(message) &&
      hasOnlyKnownKeys(message, keys) &&
      message["type"] === type &&
      isId(message["proposalId"]) &&
      (message["signerAccountId"] === undefined || isAccountId(message["signerAccountId"]))
    )
  ) {
    return null;
  }
  if (message["untrackedVerified"] !== undefined && message["untrackedVerified"] !== true) {
    return null;
  }
  return {
    proposalId: message["proposalId"],
    ...(message["signerAccountId"] === undefined
      ? {}
      : { signerAccountId: message["signerAccountId"] }),
    ...(message["untrackedVerified"] === true ? { untrackedVerified: true } : {}),
  };
};

/**
 * Parses a track request for a proposal id shared out-of-band.
 */
export const readTrackMultisigProposalInput = (
  message: unknown,
): {
  readonly call?: TrackedMultisigCall;
  readonly multisigId: string;
  readonly summary?: string;
  readonly txId: string;
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["call", "multisigId", "summary", "txId", "type"]) ||
    message["type"] !== "wallet.trackMultisigProposal" ||
    !isId(message["multisigId"]) ||
    typeof message["txId"] !== "string" ||
    !isStarkFieldElement(message["txId"]) ||
    !isOptionalSummary(message["summary"])
  ) {
    return null;
  }
  const call = message["call"] === undefined ? undefined : readTrackedCall(message["call"]);
  if (call === null) {
    return null;
  }
  return {
    ...(call === undefined ? {} : { call }),
    multisigId: message["multisigId"] as string,
    ...(message["summary"] === undefined ? {} : { summary: message["summary"] }),
    txId: message["txId"],
  };
};

/**
 * Parsed deploy request for a new multisig contract. No name is carried: the
 * deploy handler intentionally does not watch the contract until it is
 * finalized on-chain, so a name is chosen when the deployed multisig is later
 * added through `wallet.addMultisig`.
 */
export type DeployMultisigInput = {
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
  hasOnlyKnownKeys(message, ["quorum", "salt", "signers", "type"]) &&
  message["type"] === "wallet.deployMultisig" &&
  Array.isArray(message["signers"]) &&
  message["signers"].length >= 1 &&
  message["signers"].length <= MAX_SIGNERS &&
  message["signers"].every(
    (signer) => typeof signer === "string" && isNonZeroStarkFieldElement(signer),
  ) &&
  typeof message["quorum"] === "number" &&
  Number.isSafeInteger(message["quorum"]) &&
  message["quorum"] >= 1 &&
  message["quorum"] <= message["signers"].length &&
  isOptionalSalt(message["salt"])
    ? {
        quorum: message["quorum"],
        salt: message["salt"] ?? "0x0",
        signers: message["signers"] as readonly string[],
      }
    : null;
