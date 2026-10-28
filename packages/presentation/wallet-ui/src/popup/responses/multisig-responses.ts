/** Strict response validators for privileged Argent multisig messages. */
import {
  hasOnlyArrayEntries,
  hasOnlyKnownKeys,
  isJson,
  isOwnDataProperty,
  isRecord,
  JSON_BUDGETS,
} from "@bramble/core/json";
import type {
  ArgentMultisigAuthorityStatus,
  ArgentMultisigConfig,
  ArgentUnsupportedSigner,
} from "@bramble/multisig/chain";
import { MULTISIG_LIMITS } from "@bramble/multisig/chain";
import {
  type ArgentMultisigRecord,
  type ArgentMultisigSigningIntent,
  canReplaceArgentMultisigSigningIntent,
  isArgentMultisigRecord,
  isArgentMultisigSigningIntent,
} from "@bramble/multisig/repository";
import { ARGENT_MULTISIG_CONTRACT } from "@bramble/starknet/account-contracts";
import { type FeeEstimate, isFeeEstimate } from "@bramble/starknet/fee-bounds";
import type { FeeAffordability } from "@bramble/transactions/fee-funds";
import type { AccountContractType } from "@bramble/wallet-model/accounts";
import { isAccountId } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import { isNostrPublicKey } from "@bramble/wallet-model/nostr";

/**
 * Fresh untrusted chain authority paired with one watched account.
 */
export type ArgentMultisigView = {
  readonly authorityStatus: ArgentMultisigAuthorityStatus;
  readonly config: ArgentMultisigConfig | null;
  /** Fresh deployment status; null or absent means the network read failed. */
  readonly deployed?: boolean | null;
  /** A deployment hash is known but the account has not been observed on-chain yet. */
  readonly deploymentPending?: true;
  readonly record: ArgentMultisigRecord;
  readonly unsupportedSigners: readonly ArgentUnsupportedSigner[];
};

/**
 * Versioned immutable package exchanged between independent signers.
 */
export type ArgentMultisigIntentPackage = {
  readonly intent: ArgentMultisigSigningIntent;
  readonly kind: "bramble.argent-multisig-intent";
  readonly version: 1;
};

/**
 * Exact constructor and fee authority reviewed before deployment.
 */
export type ArgentMultisigDeploymentReview = {
  readonly address: string;
  readonly fee: FeeEstimate;
  readonly feeAffordability: FeeAffordability;
  readonly name?: string;
  readonly networkId: StarknetNetworkId;
  readonly salt: string;
  readonly signerAccountId: string;
  readonly signerPublicKeys: readonly string[];
  readonly threshold: number;
};

/**
 * Complete watched-account snapshot returned by the background.
 */
export type ArgentMultisigsResponse = {
  readonly intents: readonly ArgentMultisigSigningIntent[];
  readonly multisigs: readonly ArgentMultisigView[];
  readonly ok: true;
};

/**
 * One frozen intent and its deterministic exchange package.
 */
export type ArgentMultisigIntentResponse = {
  readonly feeReview?: FeeEstimate;
  readonly intent: ArgentMultisigSigningIntent;
  readonly intentPackage?: ArgentMultisigIntentPackage;
  readonly ok: true;
  readonly transactionHash?: string;
};

/**
 * Successful Argent multisig deployment response.
 */
export type ArgentMultisigDeployResponse = {
  readonly address: string;
  readonly multisig: ArgentMultisigView;
  readonly ok: true;
  readonly transactionHash: string;
};

/**
 * Public participant metadata accepted only after strict runtime validation.
 */
export type MultisigSignerAccount = {
  readonly accountContractType: AccountContractType;
  readonly address: string;
  readonly publicKeyX: string;
};

/** Public Nostr identity returned only to the wallet's own receive screen. */
export type NostrPublicKeyResponse = {
  readonly nostrPublicKey: string;
  readonly ok: true;
};

const canonicalNonZeroFelt = (value: unknown): value is string =>
  typeof value === "string" && isNonZeroStarkFieldElement(value) && canonicalFelt(value) === value;

const isConfig = (value: unknown): value is ArgentMultisigConfig => {
  if (!isRecord(value) || !Array.isArray(value["signerGuids"])) return false;
  const signerGuids = value["signerGuids"];
  return (
    hasOnlyKnownKeys(value, ["classHash", "signerGuids", "threshold"]) &&
    value["classHash"] === ARGENT_MULTISIG_CONTRACT.classHash &&
    signerGuids.length > 0 &&
    signerGuids.length <= MULTISIG_LIMITS.signers &&
    signerGuids.every(
      (guid, index) =>
        canonicalNonZeroFelt(guid) &&
        (index === 0 || BigInt(signerGuids[index - 1] as string) < BigInt(guid)),
    ) &&
    Number.isSafeInteger(value["threshold"]) &&
    Number(value["threshold"]) > 0 &&
    Number(value["threshold"]) <= signerGuids.length
  );
};

const AUTHORITY_STATUSES: readonly ArgentMultisigAuthorityStatus[] = [
  "available",
  "invalid-config",
  "network-unavailable",
  "undeployed",
  "unsupported-class",
  "unsupported-signers",
];

const isUnsupportedSigner = (value: unknown): value is ArgentUnsupportedSigner =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["guid", "type"]) &&
  canonicalNonZeroFelt(value["guid"]) &&
  (value["type"] === "eip191" ||
    value["type"] === "secp256k1" ||
    value["type"] === "secp256r1" ||
    value["type"] === "webauthn");

const isView = (value: unknown): value is ArgentMultisigView =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "authorityStatus",
    "config",
    "deployed",
    "deploymentPending",
    "record",
    "unsupportedSigners",
  ]) &&
  AUTHORITY_STATUSES.includes(value["authorityStatus"] as ArgentMultisigAuthorityStatus) &&
  isArgentMultisigRecord(value["record"]) &&
  Array.isArray(value["unsupportedSigners"]) &&
  value["unsupportedSigners"].every(isUnsupportedSigner) &&
  (value["authorityStatus"] === "unsupported-signers") === value["unsupportedSigners"].length > 0 &&
  (value["deployed"] === undefined ||
    value["deployed"] === null ||
    typeof value["deployed"] === "boolean") &&
  (value["deploymentPending"] === undefined || value["deploymentPending"] === true) &&
  (value["deploymentPending"] !== true || value["deployed"] === null) &&
  (value["config"] === null || isConfig(value["config"]));

const isIntentPackage = (value: unknown): value is ArgentMultisigIntentPackage =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["intent", "kind", "version"]) &&
  value["kind"] === "bramble.argent-multisig-intent" &&
  value["version"] === 1 &&
  isArgentMultisigSigningIntent(value["intent"]);

/**
 * Validates watched accounts and frozen intents before the UI renders them.
 */
export const isArgentMultisigsResponse = (value: unknown): value is ArgentMultisigsResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["intents", "multisigs", "ok"]) &&
  value["ok"] === true &&
  Array.isArray(value["multisigs"]) &&
  value["multisigs"].every(isView) &&
  Array.isArray(value["intents"]) &&
  value["intents"].every(isArgentMultisigSigningIntent);

// Each entry is budgeted and validated on its own. A co-signer can share
// several individually legal intents whose sum passes the per-message JSON
// budget; a whole-envelope gate then blanked every multisig and every saved
// transaction for the user (Sherlock 160). The list keeps the two bounds that
// gate used to supply: the provider array cap and the indices-only shape.
const readEntries = <T>(
  value: unknown,
  valid: (entry: unknown) => entry is T,
): readonly T[] | null => {
  if (
    !Array.isArray(value) ||
    value.length > JSON_BUDGETS.provider.maxArrayLength ||
    !hasOnlyArrayEntries(value)
  ) {
    return null;
  }
  const entries: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!isOwnDataProperty(descriptor)) continue;
    const entry: unknown = descriptor.value;
    if (isJson(entry) && valid(entry)) entries.push(entry);
  }
  return entries;
};

/**
 * Reads the watched accounts and saved transactions a `wallet.multisigs`
 * answer carries. Returns `null` when the envelope itself is malformed or past
 * the provider array bound; otherwise every returned entry was validated and
 * budgeted on its own, and an entry that fails is dropped while the rest stay
 * usable. A co-signer's oversized proposals cannot blank the multisig screens.
 */
export const readArgentMultisigs = (
  value: unknown,
): Pick<ArgentMultisigsResponse, "intents" | "multisigs"> | null => {
  if (!isRecord(value) || !hasOnlyKnownKeys(value, ["intents", "multisigs", "ok"])) return null;
  const multisigs = readEntries(value["multisigs"], isView);
  const intents = readEntries(value["intents"], isArgentMultisigSigningIntent);
  return value["ok"] === true && multisigs && intents ? { intents, multisigs } : null;
};

/**
 * Reads one add or refresh answer under the same rules as
 * `readArgentMultisigs`: the account must validate, and each saved
 * transaction is budgeted on its own and dropped when it fails.
 */
export const readArgentMultisig = (
  value: unknown,
): {
  readonly intents: readonly ArgentMultisigSigningIntent[];
  readonly multisig: ArgentMultisigView;
} | null => {
  if (!isRecord(value) || !hasOnlyKnownKeys(value, ["intents", "multisig", "ok"])) return null;
  const multisig = value["multisig"];
  const intents = readEntries(value["intents"], isArgentMultisigSigningIntent);
  return value["ok"] === true && isJson(multisig) && isView(multisig) && intents
    ? { intents, multisig }
    : null;
};

/**
 * Validates one add or refresh result and rejects unknown fields.
 */
export const isArgentMultisigResponse = (
  value: unknown,
): value is {
  readonly intents: readonly ArgentMultisigSigningIntent[];
  readonly multisig: ArgentMultisigView;
  readonly ok: true;
} =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["intents", "multisig", "ok"]) &&
  value["ok"] === true &&
  isView(value["multisig"]) &&
  Array.isArray(value["intents"]) &&
  value["intents"].every(isArgentMultisigSigningIntent);

/**
 * Validates prepare/import/sign/submit results and exact exchange packages.
 */
export const isArgentMultisigIntentResponse = (
  value: unknown,
): value is ArgentMultisigIntentResponse => {
  if (
    !isRecord(value) ||
    !isJson(value) ||
    !hasOnlyKnownKeys(value, ["feeReview", "intent", "intentPackage", "ok", "transactionHash"]) ||
    value["ok"] !== true ||
    !isArgentMultisigSigningIntent(value["intent"]) ||
    (value["feeReview"] !== undefined && !isFeeEstimate(value["feeReview"])) ||
    (value["intentPackage"] !== undefined && !isIntentPackage(value["intentPackage"])) ||
    (value["transactionHash"] !== undefined && !canonicalNonZeroFelt(value["transactionHash"]))
  ) {
    return false;
  }
  return (
    value["intentPackage"] === undefined ||
    (canReplaceArgentMultisigSigningIntent(value["intent"], value["intentPackage"].intent) &&
      canReplaceArgentMultisigSigningIntent(value["intentPackage"].intent, value["intent"]))
  );
};

/**
 * Validates a deployment fee review without normalizing any echoed field.
 */
export const isArgentMultisigDeploymentReviewResponse = (
  value: unknown,
): value is { readonly deploymentReview: ArgentMultisigDeploymentReview; readonly ok: true } => {
  if (
    !isRecord(value) ||
    !isJson(value) ||
    !hasOnlyKnownKeys(value, ["deploymentReview", "ok"]) ||
    value["ok"] !== true ||
    !isRecord(value["deploymentReview"])
  ) {
    return false;
  }
  const review = value["deploymentReview"];
  return (
    hasOnlyKnownKeys(review, [
      "address",
      "fee",
      "feeAffordability",
      "name",
      "networkId",
      "salt",
      "signerAccountId",
      "signerPublicKeys",
      "threshold",
    ]) &&
    canonicalNonZeroFelt(review["address"]) &&
    isFeeEstimate(review["fee"]) &&
    (review["feeAffordability"] === "insufficient" ||
      review["feeAffordability"] === "ok" ||
      review["feeAffordability"] === "unknown") &&
    (review["name"] === undefined ||
      (typeof review["name"] === "string" &&
        review["name"].length > 0 &&
        review["name"].length <= MULTISIG_LIMITS.nameLength)) &&
    isStarknetNetworkId(review["networkId"]) &&
    typeof review["salt"] === "string" &&
    canonicalFelt(review["salt"]) === review["salt"] &&
    isAccountId(review["signerAccountId"]) &&
    Array.isArray(review["signerPublicKeys"]) &&
    review["signerPublicKeys"].length > 0 &&
    review["signerPublicKeys"].length <= MULTISIG_LIMITS.signers &&
    review["signerPublicKeys"].every(canonicalNonZeroFelt) &&
    Number.isSafeInteger(review["threshold"]) &&
    Number(review["threshold"]) > 0 &&
    Number(review["threshold"]) <= review["signerPublicKeys"].length
  );
};

/**
 * Validates deployment submission and the freshly read account view.
 */
export const isArgentMultisigDeployResponse = (
  value: unknown,
): value is ArgentMultisigDeployResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["address", "multisig", "ok", "transactionHash"]) &&
  value["ok"] === true &&
  canonicalNonZeroFelt(value["address"]) &&
  canonicalNonZeroFelt(value["transactionHash"]) &&
  isView(value["multisig"]) &&
  value["address"] === value["multisig"].record.address;

/**
 * Validates pinned class availability for the active network.
 */
export const isArgentMultisigClassStatusResponse = (
  value: unknown,
): value is { readonly declared: boolean; readonly ok: true } =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["declared", "ok"]) &&
  value["ok"] === true &&
  typeof value["declared"] === "boolean";

/**
 * Validates the untrusted runtime response before public signer metadata enters UI state.
 */
export const isMultisigSignerResponse = (
  value: unknown,
): value is { readonly ok: true; readonly signer: MultisigSignerAccount } =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["ok", "signer"]) &&
  value["ok"] === true &&
  isRecord(value["signer"]) &&
  hasOnlyKnownKeys(value["signer"], ["accountContractType", "address", "publicKeyX"]) &&
  (value["signer"]["accountContractType"] === "argent" ||
    value["signer"]["accountContractType"] === "openzeppelin") &&
  canonicalNonZeroFelt(value["signer"]["address"]) &&
  canonicalNonZeroFelt(value["signer"]["publicKeyX"]);

/** Validates the wallet-level public Nostr identity. */
export const isNostrPublicKeyResponse = (value: unknown): value is NostrPublicKeyResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["nostrPublicKey", "ok"]) &&
  value["ok"] === true &&
  isNostrPublicKey(value["nostrPublicKey"]);

/** Validates a recipient-specific relay share outcome. */
export const isNostrShareResponse = (
  value: unknown,
): value is {
  readonly ok: true;
  readonly recipients: number;
  readonly relays: number;
  readonly totalRecipients: number;
} =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["ok", "recipients", "relays", "totalRecipients"]) &&
  value["ok"] === true &&
  Number.isSafeInteger(value["recipients"]) &&
  Number(value["recipients"]) > 0 &&
  Number.isSafeInteger(value["relays"]) &&
  Number(value["relays"]) >= Number(value["recipients"]) &&
  Number.isSafeInteger(value["totalRecipients"]) &&
  Number(value["totalRecipients"]) >= Number(value["recipients"]);

/** Validates one bounded explicit relay-sync outcome. */
export const isNostrSyncResponse = (
  value: unknown,
): value is {
  readonly imported: number;
  readonly intentIds: readonly string[];
  readonly ok: true;
  readonly received: number;
} =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["imported", "intentIds", "ok", "received"]) &&
  value["ok"] === true &&
  Number.isSafeInteger(value["imported"]) &&
  Number(value["imported"]) >= 0 &&
  Array.isArray(value["intentIds"]) &&
  value["intentIds"].length === value["imported"] &&
  value["intentIds"].every((id) => typeof id === "string" && id.length > 0 && id.length <= 256) &&
  new Set(value["intentIds"]).size === value["intentIds"].length &&
  Number.isSafeInteger(value["received"]) &&
  Number(value["received"]) >= Number(value["imported"]);

/**
 * Validates the exact acknowledgement returned by removal.
 */
export const isOkResponse = (value: unknown): value is { readonly ok: true } =>
  isRecord(value) && isJson(value) && hasOnlyKnownKeys(value, ["ok"]) && value["ok"] === true;
