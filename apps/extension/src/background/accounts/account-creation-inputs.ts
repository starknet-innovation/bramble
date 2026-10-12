/**
 * Exact parsers for the two privileged mnemonic-bearing onboarding messages.
 * Both reject unknown keys and malformed derivation indices before anything
 * reaches the Krusty KMS boundary.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { AccountDerivationInput } from "@bramble/vault/accounts";
import type { CreateVaultAccountInput } from "@bramble/vault/service";
import type { RecoverVaultAccountsInput } from "@bramble/vault/service-types";
import { isCreatableAccountContractType } from "@bramble/wallet-model/accounts";
import {
  isStarkFieldElement,
  isStarknetNetworkId,
  normalizeFeltInput,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import {
  isMnemonicPassphrase,
  isMnemonicText,
  isVaultPassphrase,
} from "@bramble/wallet-model/passphrase";
import {
  isRecoveryAccountIndex,
  isRecoveryAccountSelection,
  RECOVERY_SCAN_LIMITS,
  type RecoveryAccountSelection,
} from "@bramble/wallet-model/recovery";

// Bounded by the hardened BIP-44 ceiling, the highest account index the
// recovery flow's manual field accepts (Sherlock 253). Recovery selects by
// account index only, so a non-zero address index is still not recoverable
// from the phrase. Only this creation boundary narrows: stored accounts are
// never re-validated against it.
const readOptionalIndex = (value: unknown): number | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return isRecoveryAccountIndex(value) ? value : null;
};

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
  if (!isCreatableAccountContractType(accountContractType)) {
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

/**
 * Parses the in-wallet imported-seed account selection. Unlike first-run
 * recovery the unlock passphrase comes from the live session, so the message
 * carries only the phrase, target network, and selections.
 */
export const readImportSeedAccountsInput = (
  message: unknown,
): Omit<RecoverVaultAccountsInput, "vaultPassphrase"> | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["mnemonic", "networkId", "selections", "type"]) ||
    message["type"] !== "wallet.importSeedAccounts" ||
    !isMnemonicText(message["mnemonic"]) ||
    !isStarknetNetworkId(message["networkId"]) ||
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
  };
};

/**
 * Parses the settings-surface discovery of the wallet's OWN accounts. The
 * message carries no phrase and no vault credential: the background reads the
 * wallet's own phrase inside the vault boundary through the live unlock session.
 */
export const readDiscoverOwnAccountsInput = (
  message: unknown,
): { readonly manualIndex?: number; readonly networkId: StarknetNetworkId } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["manualIndex", "networkId", "type"]) ||
    message["type"] !== "wallet.discoverOwnAccounts" ||
    !isStarknetNetworkId(message["networkId"]) ||
    (message["manualIndex"] !== undefined && !isRecoveryAccountIndex(message["manualIndex"]))
  ) {
    return null;
  }
  return {
    ...(message["manualIndex"] === undefined ? {} : { manualIndex: message["manualIndex"] }),
    networkId: message["networkId"],
  };
};

/**
 * Parses the settings-surface selection of the wallet's OWN discovered
 * accounts. The founding phrase is taken from the live unlock session inside the
 * vault boundary, so the panel supplies only the target network and selections.
 */
export const readImportOwnAccountsInput = (
  message: unknown,
): {
  readonly networkId: StarknetNetworkId;
  readonly selections: readonly RecoveryAccountSelection[];
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["networkId", "selections", "type"]) ||
    message["type"] !== "wallet.importOwnAccounts" ||
    !isStarknetNetworkId(message["networkId"]) ||
    !Array.isArray(message["selections"]) ||
    message["selections"].length === 0 ||
    message["selections"].length > RECOVERY_SCAN_LIMITS.maxSelections ||
    !message["selections"].every(isRecoveryAccountSelection)
  ) {
    return null;
  }
  return {
    networkId: message["networkId"],
    selections: message["selections"],
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
