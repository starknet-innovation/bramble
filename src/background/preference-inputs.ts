/**
 * Preference message input readers: address book, labels, display settings,
 * RPC overrides, and backup imports.
 */
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import {
  isStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "../starknet/networks";
import { isAccountId } from "../storage/vault-schema";

/**
 * Parses address-book save messages from extension pages.
 */
export const readSaveAddressInput = (
  message: unknown,
): {
  readonly address: string;
  readonly label: string;
  readonly networkId: StarknetNetworkId;
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["address", "label", "networkId", "type"]) ||
    message.type !== "wallet.saveAddress" ||
    typeof message.address !== "string" ||
    !isStarkFieldElement(message.address) ||
    typeof message.label !== "string" ||
    message.label.trim().length === 0 ||
    message.label.trim().length > 64 ||
    !isStarknetNetworkId(message.networkId)
  ) {
    return null;
  }

  return {
    address: message.address,
    label: message.label.trim(),
    networkId: message.networkId,
  };
};

/**
 * Parses address book removal requests from extension pages.
 */
export const readRemoveAddressInput = (message: unknown): { readonly id: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["id", "type"]) &&
  message.type === "wallet.removeAddress" &&
  typeof message.id === "string" &&
  message.id.length > 0 &&
  message.id.length <= 200
    ? { id: message.id }
    : null;

/**
 * Parses account label updates from extension pages.
 */
export const readSetAccountLabelInput = (
  message: unknown,
): { readonly accountId: string; readonly label: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["accountId", "label", "type"]) &&
  message.type === "wallet.setAccountLabel" &&
  isAccountId(message.accountId) &&
  typeof message.label === "string" &&
  message.label.length <= 64
    ? { accountId: message.accountId, label: message.label }
    : null;

/**
 * Parses display preference updates (currency, theme) from extension pages.
 */
export const readSetDisplayInput = (
  message: unknown,
): {
  readonly displayCurrency?: "eur" | "gbp" | "usd";
  readonly theme?: "dark" | "light";
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["displayCurrency", "theme", "type"]) ||
    message.type !== "wallet.setDisplay"
  ) {
    return null;
  }
  const displayCurrency =
    message.displayCurrency === "eur" ||
    message.displayCurrency === "gbp" ||
    message.displayCurrency === "usd"
      ? message.displayCurrency
      : undefined;
  const theme = message.theme === "dark" || message.theme === "light" ? message.theme : undefined;
  if (
    (message.displayCurrency !== undefined && displayCurrency === undefined) ||
    (message.theme !== undefined && theme === undefined)
  ) {
    return null;
  }
  return {
    ...(displayCurrency === undefined ? {} : { displayCurrency }),
    ...(theme === undefined ? {} : { theme }),
  };
};

/**
 * Parses preferences backup imports; deep validation happens in the store.
 */
export const readImportPreferencesInput = (
  message: unknown,
): { readonly preferences: unknown } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["preferences", "type"]) &&
  message.type === "wallet.importPreferences" &&
  isRecord(message.preferences)
    ? { preferences: message.preferences }
    : null;

/**
 * Parses custom RPC override requests. An empty rpcUrl clears the override.
 */
export const readSetRpcOverrideInput = (
  message: unknown,
): { readonly networkId: StarknetNetworkId; readonly rpcUrl: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["networkId", "rpcUrl", "type"]) ||
    message.type !== "wallet.setRpcOverride" ||
    !isStarknetNetworkId(message.networkId) ||
    typeof message.rpcUrl !== "string" ||
    message.rpcUrl.length > 2048
  ) {
    return null;
  }

  return {
    networkId: message.networkId,
    rpcUrl: message.rpcUrl,
  };
};

/**
 * Parses STRK20 prover endpoint updates. An empty url clears the override.
 */
export const readSetStrk20ProverUrlInput = (message: unknown): { readonly url: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["type", "url"]) ||
    message.type !== "wallet.setStrk20ProverUrl" ||
    typeof message.url !== "string" ||
    message.url.length > 2048
  ) {
    return null;
  }

  return { url: message.url };
};
