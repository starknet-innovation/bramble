/**
 * Parsers for the privileged Ledger background messages. Each validates the
 * untrusted extension-page payload once, at this boundary, into a precise type
 * the handlers can trust. No secret material crosses here: a Ledger message
 * carries only a device public key, an account index, a derivation path, and a
 * public `(r, s)` signature pair.
 */

import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { isLedgerAccountIndex } from "@mc-wallet/wallet-model/ledger-path";
import {
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";
import type { LedgerPubKeyEntry } from "@mc-wallet/wallet-model/accounts";

const isFeltString = (value: unknown): value is string =>
  typeof value === "string" && isStarkFieldElement(value);

const isNonZeroFeltString = (value: unknown): value is string =>
  typeof value === "string" && isNonZeroStarkFieldElement(value);

/**
 * Parsed request to store a keyless Ledger account from a device public key.
 */
export type AddLedgerAccountRequest = {
  readonly accountIndex: number;
  readonly networkId: StarknetNetworkId;
  readonly publicKeyX: string;
};

/**
 * Parses a `wallet.addLedgerAccount` request or returns null when malformed.
 */
export const readAddLedgerAccountInput = (message: unknown): AddLedgerAccountRequest | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["accountIndex", "networkId", "publicKeyX", "type"]) ||
    message["type"] !== "wallet.addLedgerAccount" ||
    !isLedgerAccountIndex(message["accountIndex"]) ||
    !isStarknetNetworkId(message["networkId"]) ||
    !isNonZeroFeltString(message["publicKeyX"])
  ) {
    return null;
  }
  return {
    accountIndex: message["accountIndex"],
    networkId: message["networkId"],
    publicKeyX: message["publicKeyX"],
  };
};

/**
 * Parsed request to create a brand-new mnemonic-less vault whose first account
 * is a keyless Ledger account. Carries the vault passphrase (which encrypts the
 * account registry) plus the device public key and index; no seed is generated.
 */
export type CreateLedgerVaultRequest = {
  readonly accountIndex: number;
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
      "networkId",
      "publicKeyX",
      "type",
      "vaultPassphrase",
    ]) ||
    message["type"] !== "wallet.createLedgerVault" ||
    !isLedgerAccountIndex(message["accountIndex"]) ||
    !isStarknetNetworkId(message["networkId"]) ||
    !isNonZeroFeltString(message["publicKeyX"]) ||
    typeof message["vaultPassphrase"] !== "string"
  ) {
    return null;
  }
  return {
    accountIndex: message["accountIndex"],
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
 * Parsed request to derive addresses for a batch of enumerated Ledger pairs.
 */
export type DeriveLedgerAccountsRequest = {
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
    !hasOnlyKnownKeys(message, ["entries", "networkId", "type"]) ||
    message["type"] !== "wallet.deriveLedgerAccounts" ||
    !isStarknetNetworkId(message["networkId"]) ||
    !Array.isArray(message["entries"]) ||
    !message["entries"].every(isPubKeyEntry)
  ) {
    return null;
  }
  return {
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
