/**
 * Exact parsers for the two privileged mnemonic-bearing onboarding messages.
 * Both reject unknown keys and malformed derivation indices before anything
 * reaches the Krusty KMS boundary.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import type { AccountDerivationInput } from "@mc-wallet/vault/accounts";
import type { CreateVaultAccountInput } from "@mc-wallet/vault/service";
import { isStarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import { isVaultPassphrase } from "@mc-wallet/wallet-model/passphrase";

const readOptionalIndex = (value: unknown): number | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
};

const isMnemonicText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const readDerivationFields = (
  message: Record<string, unknown>,
): Omit<AccountDerivationInput, "mnemonic"> | null => {
  const accountIndex = readOptionalIndex(message["accountIndex"]);
  const addressIndex = readOptionalIndex(message["addressIndex"]);
  if (accountIndex === null || addressIndex === null) {
    return null;
  }
  if (
    message["mnemonicPassphrase"] !== undefined &&
    typeof message["mnemonicPassphrase"] !== "string"
  ) {
    return null;
  }
  if (message["networkId"] !== undefined && !isStarknetNetworkId(message["networkId"])) {
    return null;
  }
  return {
    ...(accountIndex === undefined ? {} : { accountIndex }),
    ...(addressIndex === undefined ? {} : { addressIndex }),
    ...(message["mnemonicPassphrase"] === undefined
      ? {}
      : { mnemonicPassphrase: message["mnemonicPassphrase"] }),
    ...(message["networkId"] === undefined ? {} : { networkId: message["networkId"] }),
  };
};

/**
 * Parses the final account-creation request including the vault encryption
 * passphrase. Failure returns null without echoing secret material.
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
    message["type"] !== "wallet.createAccount" ||
    !isMnemonicText(message["mnemonic"]) ||
    !isVaultPassphrase(message["vaultPassphrase"])
  ) {
    return null;
  }
  const derivation = readDerivationFields(message);
  return derivation
    ? { ...derivation, mnemonic: message["mnemonic"], vaultPassphrase: message["vaultPassphrase"] }
    : null;
};

/**
 * Parses the read-only onboarding account preview. The request accepts no
 * vault passphrase because it performs no persistence or unlock operation.
 */
export const readPreviewAccountInput = (message: unknown): AccountDerivationInput | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, [
      "accountIndex",
      "addressIndex",
      "mnemonic",
      "mnemonicPassphrase",
      "networkId",
      "type",
    ]) ||
    message["type"] !== "wallet.previewAccount" ||
    !isMnemonicText(message["mnemonic"])
  ) {
    return null;
  }
  const derivation = readDerivationFields(message);
  return derivation ? { ...derivation, mnemonic: message["mnemonic"] } : null;
};
