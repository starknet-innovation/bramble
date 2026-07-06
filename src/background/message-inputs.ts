/**
 * Pure parsers for untrusted background runtime messages.
 */

import { isUuid } from "../shared/ids";
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import { normalizeWalletOrigin } from "../shared/origin";
import {
  isStarkFieldElement,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
} from "../starknet/networks";
import { isVaultPassphrase } from "../storage/encrypted-store";
import { isAccountId } from "../storage/vault-schema";
import type {
  CreateVaultAccountInput,
  OriginGrantInput,
  SignHashInput,
} from "../wallet/vault-service";

const readOptionalIndex = (value: unknown): number | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
};

const isNetworkId = (value: unknown): value is StarknetNetworkId =>
  typeof value === "string" && value in STARKNET_NETWORKS;

const isMnemonicText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Parses no-payload runtime messages by exact type.
 */
export const readTypeOnlyInput = (message: unknown, type: string): boolean =>
  isRecord(message) && hasOnlyKnownKeys(message, ["type"]) && message.type === type;

/**
 * Parses privileged account-import messages from extension pages.
 */
export const readCreateAccountInput = (message: unknown): CreateVaultAccountInput | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, [
      "accountIndex",
      "addressIndex",
      "mnemonic",
      "mnemonicPassphrase",
      "networkId",
      "type",
      "vaultPassphrase",
    ]) ||
    message.type !== "wallet.createAccount" ||
    !isMnemonicText(message.mnemonic) ||
    !isVaultPassphrase(message.vaultPassphrase)
  ) {
    return null;
  }

  const accountIndex = readOptionalIndex(message.accountIndex);
  const addressIndex = readOptionalIndex(message.addressIndex);
  if (accountIndex === null || addressIndex === null) {
    return null;
  }

  if (message.mnemonicPassphrase !== undefined && typeof message.mnemonicPassphrase !== "string") {
    return null;
  }

  if (message.networkId !== undefined && !isNetworkId(message.networkId)) {
    return null;
  }

  return {
    ...(accountIndex === undefined ? {} : { accountIndex }),
    ...(addressIndex === undefined ? {} : { addressIndex }),
    mnemonic: message.mnemonic,
    ...(message.mnemonicPassphrase === undefined
      ? {}
      : { mnemonicPassphrase: message.mnemonicPassphrase }),
    ...(message.networkId === undefined ? {} : { networkId: message.networkId }),
    vaultPassphrase: message.vaultPassphrase,
  };
};

/**
 * Parses privileged origin-grant messages and normalizes origins.
 */
export const readGrantOriginInput = (message: unknown): OriginGrantInput | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["accountId", "origin", "type", "vaultPassphrase"]) ||
    message.type !== "wallet.grantOrigin" ||
    !isVaultPassphrase(message.vaultPassphrase)
  ) {
    return null;
  }

  const origin = normalizeWalletOrigin(message.origin);
  if (!origin || (message.accountId !== undefined && !isAccountId(message.accountId))) {
    return null;
  }

  return {
    ...(message.accountId === undefined ? {} : { accountId: message.accountId }),
    origin,
    vaultPassphrase: message.vaultPassphrase,
  };
};

/**
 * Parses account-read messages and optional extension-page passphrases.
 */
export const readGetGrantedAccountsInput = (
  message: unknown,
): { readonly origin: string; readonly vaultPassphrase?: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["origin", "type", "vaultPassphrase"]) ||
    message.type !== "wallet.getGrantedAccounts" ||
    (message.vaultPassphrase !== undefined && !isVaultPassphrase(message.vaultPassphrase))
  ) {
    return null;
  }

  const origin = normalizeWalletOrigin(message.origin);
  if (!origin) {
    return null;
  }

  return {
    origin,
    ...(message.vaultPassphrase === undefined ? {} : { vaultPassphrase: message.vaultPassphrase }),
  };
};

/**
 * Parses popup approval decisions by pending approval id.
 */
export const readApprovalIdInput = (message: unknown): { readonly id: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["id", "type"]) ||
    (message.type !== "wallet.approveOrigin" && message.type !== "wallet.denyOrigin") ||
    typeof message.id !== "string" ||
    !isUuid(message.id)
  ) {
    return null;
  }
  return { id: message.id };
};

/**
 * Parses dapp account requests from content-script traffic.
 */
export const readRequestAccountsInput = (message: unknown): { readonly origin: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["origin", "type"]) ||
    message.type !== "wallet.requestAccounts"
  ) {
    return null;
  }

  const origin = normalizeWalletOrigin(message.origin);
  return origin ? { origin } : null;
};

/**
 * Parses privileged hash-signing requests without accepting non-hex hashes.
 */
export const readSignHashInput = (message: unknown): SignHashInput | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["accountId", "messageHash", "type", "vaultPassphrase"]) ||
    message.type !== "wallet.signHash" ||
    typeof message.messageHash !== "string" ||
    !isStarkFieldElement(message.messageHash) ||
    !isVaultPassphrase(message.vaultPassphrase)
  ) {
    return null;
  }

  if (message.accountId !== undefined && !isAccountId(message.accountId)) {
    return null;
  }

  return {
    ...(message.accountId === undefined ? {} : { accountId: message.accountId }),
    messageHash: message.messageHash,
    vaultPassphrase: message.vaultPassphrase,
  };
};

/**
 * Parses popup unlock messages carrying the vault passphrase.
 */
export const readUnlockInput = (message: unknown): { readonly vaultPassphrase: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["type", "vaultPassphrase"]) ||
    message.type !== "wallet.unlock" ||
    !isVaultPassphrase(message.vaultPassphrase)
  ) {
    return null;
  }
  return { vaultPassphrase: message.vaultPassphrase };
};
