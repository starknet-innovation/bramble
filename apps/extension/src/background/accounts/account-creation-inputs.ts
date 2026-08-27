/**
 * Exact parsers for the two privileged mnemonic-bearing onboarding messages.
 * Both reject unknown keys and malformed derivation indices before anything
 * reaches the Krusty KMS boundary.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import type { AccountDerivationInput } from "@mc-wallet/vault/accounts";
import type { CreateVaultAccountInput } from "@mc-wallet/vault/service";
import type { RecoverVaultAccountsInput } from "@mc-wallet/vault/service-types";
import { type AccountContractType, isAccountContractType } from "@mc-wallet/wallet-model/accounts";
import {
  isStarkFieldElement,
  isStarknetNetworkId,
  normalizeFeltInput,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";
import {
  isMnemonicPassphrase,
  isMnemonicText,
  isVaultPassphrase,
} from "@mc-wallet/wallet-model/passphrase";
import {
  isRecoveryAccountIndex,
  isRecoveryAccountSelection,
  RECOVERY_SCAN_LIMITS,
} from "@mc-wallet/wallet-model/recovery";

const readOptionalIndex = (value: unknown): number | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
};

// The contract families an account derived from a mnemonic or an imported key
// may claim. `ml-dsa` is a valid family but not a valid answer here: a
// paired-phone account has no mnemonic and no importable key, and is only ever
// created by enrolling a device. Accepting it would mean a vault-keyed account
// labelled post-quantum that can never produce a signature its own contract
// accepts — the account model refuses that pairing too, so this keeps the
// refusal at the message boundary where the reason is still legible.
const isKeyDerivedContractType = (
  value: unknown,
): value is Exclude<AccountContractType, "ml-dsa"> =>
  isAccountContractType(value) && value !== "ml-dsa";

const readDeploymentSalt = (
  value: unknown,
  accountContractType: AccountDerivationInput["accountContractType"],
): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || accountContractType === "openzeppelin") {
    return null;
  }
  const salt = normalizeFeltInput(value);
  return isStarkFieldElement(salt) ? salt : null;
};

const readDerivationFields = (
  message: Record<string, unknown>,
): Omit<AccountDerivationInput, "mnemonic"> | null => {
  const accountIndex = readOptionalIndex(message["accountIndex"]);
  const addressIndex = readOptionalIndex(message["addressIndex"]);
  if (accountIndex === null || addressIndex === null) {
    return null;
  }
  if (!isMnemonicPassphrase(message["mnemonicPassphrase"])) {
    return null;
  }
  const accountContractType = message["accountContractType"];
  if (!isKeyDerivedContractType(accountContractType)) {
    return null;
  }
  const deploymentSalt = readDeploymentSalt(message["deploymentSalt"], accountContractType);
  if (deploymentSalt === null) {
    return null;
  }
  if (message["networkId"] !== undefined && !isStarknetNetworkId(message["networkId"])) {
    return null;
  }
  return {
    accountContractType,
    ...(deploymentSalt === undefined ? {} : { deploymentSalt }),
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
      "accountContractType",
      "addressIndex",
      "deploymentSalt",
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
      "accountContractType",
      "addressIndex",
      "deploymentSalt",
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

/** Parses one bounded account-discovery page or advanced manual index. */
export const readDiscoverRecoveryAccountsInput = (
  message: unknown,
): {
  readonly manualIndex?: number;
  readonly mnemonic: string;
  readonly networkId: StarknetNetworkId;
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["manualIndex", "mnemonic", "networkId", "type"]) ||
    message["type"] !== "wallet.discoverRecoveryAccounts" ||
    !isMnemonicText(message["mnemonic"]) ||
    !isStarknetNetworkId(message["networkId"]) ||
    (message["manualIndex"] !== undefined && !isRecoveryAccountIndex(message["manualIndex"]))
  ) {
    return null;
  }
  return {
    ...(message["manualIndex"] === undefined ? {} : { manualIndex: message["manualIndex"] }),
    mnemonic: message["mnemonic"],
    networkId: message["networkId"],
  };
};

/** Parses the final confirmed account set for one atomic vault restoration. */
export const readRecoverAccountsInput = (message: unknown): RecoverVaultAccountsInput | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, [
      "mnemonic",
      "networkId",
      "selections",
      "type",
      "vaultPassphrase",
    ]) ||
    message["type"] !== "wallet.recoverAccounts" ||
    !isMnemonicText(message["mnemonic"]) ||
    !isStarknetNetworkId(message["networkId"]) ||
    !isVaultPassphrase(message["vaultPassphrase"]) ||
    !Array.isArray(message["selections"]) ||
    message["selections"].length === 0 ||
    message["selections"].length > RECOVERY_SCAN_LIMITS.maxSelections ||
    !message["selections"].every(isRecoveryAccountSelection)
  ) {
    return null;
  }
  return {
    mnemonic: message["mnemonic"],
    networkId: message["networkId"],
    selections: message["selections"],
    vaultPassphrase: message["vaultPassphrase"],
  };
};

/**
 * Parses the privileged mnemonic-validity check. Accepts only the phrase and
 * type; never a vault passphrase or derivation fields.
 */
export const readValidateMnemonicInput = (
  message: unknown,
): { readonly mnemonic: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["mnemonic", "type"]) ||
    message["type"] !== "wallet.validateMnemonic" ||
    !isMnemonicText(message["mnemonic"])
  ) {
    return null;
  }
  return { mnemonic: message["mnemonic"] };
};
