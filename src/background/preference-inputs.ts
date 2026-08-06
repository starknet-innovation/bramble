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
import { isStrk20NetworkConfig, type Strk20NetworkConfig } from "../starknet/strk20/config";
import { type AccountGroupIcon, isAccountGroupIcon } from "../storage/account-groups";
import { isApprovalSurfacePreference, isDisplayCurrency } from "../storage/preferences-entries";
import { isAccountId } from "../storage/vault-schema";

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
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["address", "label", "networkId", "type"]) ||
    message["type"] !== "wallet.saveAddress" ||
    typeof message["address"] !== "string" ||
    !isStarkFieldElement(message["address"]) ||
    typeof message["label"] !== "string" ||
    message["label"].trim().length === 0 ||
    message["label"].trim().length > 64 ||
    !isStarknetNetworkId(message["networkId"])
  ) {
    return null;
  }

  return {
    address: message["address"],
    label: message["label"].trim(),
    networkId: message["networkId"],
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
