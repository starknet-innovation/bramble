/**
 * Parsers for the privileged Ledger background messages. Each validates the
 * untrusted extension-page payload once, at this boundary, into a precise type
 * the handlers can trust. No secret material crosses here: a Ledger message
 * carries only a device public key, an account index, a derivation path, and a
 * public `(r, s)` signature pair.
 */

import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import {
  isLedgerAccountContractType,
  type LedgerAccountContractType,
  type LedgerPubKeyEntry,
} from "@bramble/wallet-model/accounts";
import {
  isLedgerAccountIndex,
  isLedgerApplicationForFamily,
  isLedgerEip2645Application,
  type LedgerEip2645Application,
  MAX_LEDGER_ACCOUNT_BATCH,
} from "@bramble/wallet-model/ledger-path";
import {
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";

const isFeltString = (value: unknown): value is string =>
  typeof value === "string" && isStarkFieldElement(value);

const isNonZeroFeltString = (value: unknown): value is string =>
  typeof value === "string" && isNonZeroStarkFieldElement(value);

// The path scheme is optional on the wire (absent means Bramble's own LedgerW
// scheme, as every pre-Ready message did) but, when present, must be one of the
// two closed markers: an unknown application would derive a key no device path
// this wallet builds can reach.
const isOptionalApplication = (value: unknown): value is LedgerEip2645Application | undefined =>
  value === undefined || isLedgerEip2645Application(value);

const optionalApplication = (
  value: LedgerEip2645Application | undefined,
): { readonly eip2645application?: LedgerEip2645Application } =>
  value === undefined ? {} : { eip2645application: value };

/**
 * Parsed request to store a keyless Ledger account from a device public key.
 * `eip2645application` is the path scheme the key was enumerated at; absent
 * means Bramble's own `LedgerW` scheme.
 */
export type AddLedgerAccountRequest = {
  readonly accountContractType: LedgerAccountContractType;
  readonly accountIndex: number;
  readonly eip2645application?: LedgerEip2645Application;
  readonly networkId: StarknetNetworkId;
  readonly publicKeyX: string;
};

/**
 * Parses a `wallet.addLedgerAccount` request or returns null when malformed.
 */
export const readAddLedgerAccountInput = (message: unknown): AddLedgerAccountRequest | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, [
      "accountContractType",
      "accountIndex",
      "eip2645application",
      "networkId",
      "publicKeyX",
      "type",
    ]) ||
    message["type"] !== "wallet.addLedgerAccount" ||
    !isLedgerAccountContractType(message["accountContractType"]) ||
    !isLedgerAccountIndex(message["accountIndex"]) ||
    !isOptionalApplication(message["eip2645application"]) ||
    !isLedgerApplicationForFamily(message["accountContractType"], message["eip2645application"]) ||
    !isStarknetNetworkId(message["networkId"]) ||
    !isNonZeroFeltString(message["publicKeyX"])
  ) {
    return null;
  }
  return {
    accountContractType: message["accountContractType"],
    accountIndex: message["accountIndex"],
    ...optionalApplication(message["eip2645application"]),
    networkId: message["networkId"],
    publicKeyX: message["publicKeyX"],
  };
};

/**
 * Parsed request to create a brand-new mnemonic-less vault whose first account
 * is a keyless Ledger account. Carries the vault passphrase (which encrypts the
 * account registry) plus the device public key, index, and path scheme; no seed
 * is generated.
 */
export type CreateLedgerVaultRequest = {
  readonly accountContractType: LedgerAccountContractType;
  readonly accountIndex: number;
  readonly eip2645application?: LedgerEip2645Application;
  readonly networkId: StarknetNetworkId;
  readonly publicKeyX: string;
  readonly vaultPassphrase: string;
};

/**
 * Parses a `wallet.createLedgerVault` request or returns null when malformed.
 */
export const readCreateLedgerVaultInput = (message: unknown): CreateLedgerVaultRequest | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, [
      "accountIndex",
      "accountContractType",
      "eip2645application",
      "networkId",
      "publicKeyX",
      "type",
      "vaultPassphrase",
    ]) ||
    message["type"] !== "wallet.createLedgerVault" ||
    !isLedgerAccountContractType(message["accountContractType"]) ||
    !isLedgerAccountIndex(message["accountIndex"]) ||
    !isOptionalApplication(message["eip2645application"]) ||
    !isLedgerApplicationForFamily(message["accountContractType"], message["eip2645application"]) ||
    !isStarknetNetworkId(message["networkId"]) ||
    !isNonZeroFeltString(message["publicKeyX"]) ||
    typeof message["vaultPassphrase"] !== "string"
  ) {
    return null;
  }
  return {
    accountContractType: message["accountContractType"],
    accountIndex: message["accountIndex"],
    ...optionalApplication(message["eip2645application"]),
    networkId: message["networkId"],
    publicKeyX: message["publicKeyX"],
    vaultPassphrase: message["vaultPassphrase"],
  };
};

/**
 * Parsed request for one Ledger candidate's best-effort on-chain state: its
 * deployed status and balance at an address on a network. Read-only and
 * dapp-unreachable; carries no secret material.
 */
export type LedgerAccountStatusRequest = {
  readonly address: string;
  readonly networkId: StarknetNetworkId;
};

/**
 * Parses a `wallet.ledgerAccountStatus` request or returns null when malformed.
 */
export const readLedgerAccountStatusInput = (
  message: unknown,
): LedgerAccountStatusRequest | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["address", "networkId", "type"]) ||
    message["type"] !== "wallet.ledgerAccountStatus" ||
    !isNonZeroFeltString(message["address"]) ||
    !isStarknetNetworkId(message["networkId"])
  ) {
    return null;
  }
  return { address: message["address"], networkId: message["networkId"] };
};

const isPubKeyEntry = (value: unknown): value is LedgerPubKeyEntry =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountIndex", "publicKeyX"]) &&
  isLedgerAccountIndex(value["accountIndex"]) &&
  isNonZeroFeltString(value["publicKeyX"]);

/**
 * Parsed request to derive addresses for a batch of enumerated Ledger pairs,
 * all read at one path scheme (`eip2645application`; absent means `LedgerW`).
 */
export type DeriveLedgerAccountsRequest = {
  readonly accountContractType: LedgerAccountContractType;
  readonly eip2645application?: LedgerEip2645Application;
  readonly entries: readonly LedgerPubKeyEntry[];
  readonly networkId: StarknetNetworkId;
};

/**
 * Parses a `wallet.deriveLedgerAccounts` request or returns null when malformed.
 */
export const readDeriveLedgerAccountsInput = (
  message: unknown,
): DeriveLedgerAccountsRequest | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, [
      "accountContractType",
      "eip2645application",
      "entries",
      "networkId",
      "type",
    ]) ||
    message["type"] !== "wallet.deriveLedgerAccounts" ||
    !isLedgerAccountContractType(message["accountContractType"]) ||
    !isOptionalApplication(message["eip2645application"]) ||
    !isLedgerApplicationForFamily(message["accountContractType"], message["eip2645application"]) ||
    !isStarknetNetworkId(message["networkId"]) ||
    !Array.isArray(message["entries"]) ||
    message["entries"].length > MAX_LEDGER_ACCOUNT_BATCH ||
    !message["entries"].every(isPubKeyEntry)
  ) {
    return null;
  }
  return {
    accountContractType: message["accountContractType"],
    ...optionalApplication(message["eip2645application"]),
    entries: message["entries"].map((entry) => ({
      accountIndex: entry.accountIndex,
      publicKeyX: entry.publicKeyX,
    })),
    networkId: message["networkId"],
  };
};

/**
 * A panel's response to a pending device sign: either the device `(r, s)` for
 * the given queue id, or a typed rejection code the queue propagates as an error.
 */
export type CompleteLedgerSignRequest =
  | { readonly id: string; readonly r: string; readonly s: string }
  | { readonly error: string; readonly id: string };

// Deliberately not `isNetworkLabel` (shared/json): these are a queue id the
// wallet itself minted and a rejection code, matched exactly by the queue, not
// free text a user reads. Trimming or capping them would change which callbacks
// resolve a pending device signature, so this rule stays local and literal.
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/**
 * Parses a `wallet.completeLedgerSign` callback from the side panel, or returns
 * null when malformed. Accepts either a completed signature or a rejection.
 */
export const readCompleteLedgerSignInput = (message: unknown): CompleteLedgerSignRequest | null => {
  if (!isRecord(message) || message["type"] !== "wallet.completeLedgerSign") {
    return null;
  }
  const id = message["id"];
  if (!isNonEmptyString(id)) {
    return null;
  }
  if (
    hasOnlyKnownKeys(message, ["id", "r", "s", "type"]) &&
    isFeltString(message["r"]) &&
    isFeltString(message["s"])
  ) {
    return { id, r: message["r"], s: message["s"] };
  }
  if (hasOnlyKnownKeys(message, ["error", "id", "type"]) && isNonEmptyString(message["error"])) {
    return { error: message["error"], id };
  }
  return null;
};
