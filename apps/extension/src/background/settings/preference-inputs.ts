/**
 * Preference message input readers: address book, labels, display settings,
 * RPC overrides, and backup imports.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { isStrk20NetworkConfig, type Strk20NetworkConfig } from "@mc-wallet/privacy/config";
import { type AccountGroupIcon, isAccountGroupIcon } from "@mc-wallet/settings/groups";
import { isAccountId } from "@mc-wallet/wallet-model/accounts";
import {
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";
import {
  isApprovalSurfacePreference,
  isDisplayCurrency,
} from "@mc-wallet/wallet-model/preferences";

const isGroupNameText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= 64;

const isGroupIdText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 80;

/**
 * Parses address-book save messages from extension pages.
 */
export const readSaveAddressInput = (
  message: unknown,
): {
  readonly address: string;
  readonly label: string;
  readonly networkId: StarknetNetworkId;
  readonly publicKeyX?: string;
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["address", "label", "networkId", "publicKeyX", "type"]) ||
    message["type"] !== "wallet.saveAddress" ||
    typeof message["address"] !== "string" ||
    !isStarkFieldElement(message["address"]) ||
    typeof message["label"] !== "string" ||
    message["label"].trim().length === 0 ||
    message["label"].trim().length > 64 ||
    !isStarknetNetworkId(message["networkId"]) ||
    (message["publicKeyX"] !== undefined &&
      (typeof message["publicKeyX"] !== "string" ||
        !isNonZeroStarkFieldElement(message["publicKeyX"])))
  ) {
    return null;
  }

  return {
    address: message["address"],
    label: message["label"].trim(),
    networkId: message["networkId"],
    ...(typeof message["publicKeyX"] === "string" ? { publicKeyX: message["publicKeyX"] } : {}),
  };
};

/**
 * Parses address book removal requests from extension pages.
 */
export const readRemoveAddressInput = (message: unknown): { readonly id: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["id", "type"]) &&
  message["type"] === "wallet.removeAddress" &&
  typeof message["id"] === "string" &&
  message["id"].length > 0 &&
  message["id"].length <= 200
    ? { id: message["id"] }
    : null;

/**
 * Parses account label updates from extension pages.
 */
export const readSetAccountLabelInput = (
  message: unknown,
): { readonly accountId: string; readonly label: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["accountId", "label", "type"]) &&
  message["type"] === "wallet.setAccountLabel" &&
  isAccountId(message["accountId"]) &&
  typeof message["label"] === "string" &&
  message["label"].length <= 64
    ? { accountId: message["accountId"], label: message["label"] }
    : null;

/**
 * Parses new-group creation messages from extension pages.
 */
export const readCreateGroupInput = (
  message: unknown,
): { readonly icon: AccountGroupIcon; readonly name: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["icon", "name", "type"]) &&
  message["type"] === "wallet.createGroup" &&
  isGroupNameText(message["name"]) &&
  isAccountGroupIcon(message["icon"])
    ? { icon: message["icon"], name: message["name"].trim() }
    : null;

/**
 * Parses group-rename messages from extension pages.
 */
export const readRenameGroupInput = (
  message: unknown,
): { readonly id: string; readonly name: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["id", "name", "type"]) &&
  message["type"] === "wallet.renameGroup" &&
  isGroupIdText(message["id"]) &&
  isGroupNameText(message["name"])
    ? { id: message["id"], name: message["name"].trim() }
    : null;

/**
 * Parses group icon-change messages from extension pages.
 */
export const readSetGroupIconInput = (
  message: unknown,
): { readonly icon: AccountGroupIcon; readonly id: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["icon", "id", "type"]) &&
  message["type"] === "wallet.setGroupIcon" &&
  isGroupIdText(message["id"]) &&
  isAccountGroupIcon(message["icon"])
    ? { icon: message["icon"], id: message["id"] }
    : null;

/**
 * Parses group-removal messages from extension pages.
 */
export const readRemoveGroupInput = (message: unknown): { readonly id: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["id", "type"]) &&
  message["type"] === "wallet.removeGroup" &&
  isGroupIdText(message["id"])
    ? { id: message["id"] }
    : null;

/**
 * Parses account group-membership toggles from extension pages.
 */
export const readSetAccountInGroupInput = (
  message: unknown,
): { readonly accountId: string; readonly groupId: string; readonly member: boolean } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["accountId", "groupId", "member", "type"]) &&
  message["type"] === "wallet.setAccountInGroup" &&
  isAccountId(message["accountId"]) &&
  isGroupIdText(message["groupId"]) &&
  typeof message["member"] === "boolean"
    ? { accountId: message["accountId"], groupId: message["groupId"], member: message["member"] }
    : null;

/**
 * Parses display and approval-surface preference updates from extension pages.
 */
export const readSetDisplayInput = (
  message: unknown,
): {
  readonly approvalSurface?: "popup" | "side-panel";
  readonly displayCurrency?: "eur" | "gbp" | "usd";
  readonly theme?: "dark" | "light";
} | null => {
  if (!isRecord(message)) {
    return null;
  }
  if (!hasOnlyKnownKeys(message, ["approvalSurface", "displayCurrency", "theme", "type"])) {
    return null;
  }
  if (message["type"] !== "wallet.setDisplay") {
    return null;
  }
  const approvalSurface = message["approvalSurface"];
  const displayCurrency = message["displayCurrency"];
  const theme = message["theme"];
  if (approvalSurface !== undefined && !isApprovalSurfacePreference(approvalSurface)) {
    return null;
  }
  if (displayCurrency !== undefined && !isDisplayCurrency(displayCurrency)) {
    return null;
  }
  if (theme !== undefined && theme !== "dark" && theme !== "light") {
    return null;
  }
  return {
    ...(approvalSurface === undefined ? {} : { approvalSurface }),
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
  message["type"] === "wallet.importPreferences" &&
  isRecord(message["preferences"])
    ? { preferences: message["preferences"] }
    : null;

/**
 * Parses an explicit per-network explorer-fallback choice. Extension-page only
 * and untrusted like every other message: an unknown key, a non-boolean
 * `enabled`, or an unknown network yields null so the caller answers with an
 * error instead of recording a disclosure decision the user did not make.
 */
export const readSetExplorerFallbackInput = (
  message: unknown,
): { readonly enabled: boolean; readonly networkId: StarknetNetworkId } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["enabled", "networkId", "type"]) &&
  message["type"] === "wallet.setExplorerFallback" &&
  isStarknetNetworkId(message["networkId"]) &&
  typeof message["enabled"] === "boolean"
    ? { enabled: message["enabled"], networkId: message["networkId"] }
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
    message["type"] !== "wallet.setRpcOverride" ||
    !isStarknetNetworkId(message["networkId"]) ||
    typeof message["rpcUrl"] !== "string" ||
    message["rpcUrl"].length > 2048
  ) {
    return null;
  }

  return {
    networkId: message["networkId"],
    rpcUrl: message["rpcUrl"],
  };
};

/**
 * Parses complete per-network STRK20 service routing. Null disables privacy
 * operations for that network; partial configurations are rejected.
 */
export const readSetStrk20NetworkConfigInput = (
  message: unknown,
): {
  readonly config: Strk20NetworkConfig | null;
  readonly networkId: StarknetNetworkId;
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["config", "networkId", "type"]) ||
    message["type"] !== "wallet.setStrk20NetworkConfig" ||
    !isStarknetNetworkId(message["networkId"]) ||
    (message["config"] !== null && !isStrk20NetworkConfig(message["config"]))
  ) {
    return null;
  }
  return { config: message["config"], networkId: message["networkId"] };
};
