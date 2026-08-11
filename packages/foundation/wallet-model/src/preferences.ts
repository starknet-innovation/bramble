/**
 * Pure value types and validators for the plain preferences store's entry
 * collections — tokens, address-book contacts, account labels, hidden tokens,
 * RPC overrides — plus the small shared guards they lean on. Extracted from
 * `preferences-store.ts` so that file stays under the repository line cap; the
 * store re-exports the public types so existing import paths are unchanged.
 */
import { hasOnlyKnownKeys, hasUniqueStrings, isRecord, isSafeDecimals } from "@mc-wallet/core/json";
import { isAccountId } from "@mc-wallet/wallet-model/accounts";
import {
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";
import { isCustomRpcUrl } from "./custom-network";

/**
 * User-configured ERC20 token metadata.
 */
export type TokenConfig = {
  readonly address: string;
  readonly decimals: number;
  readonly id: string;
  readonly name: string;
  readonly networkId: StarknetNetworkId;
  readonly symbol: string;
};

/**
 * User-configured recipient shortcut.
 */
export type AddressBookEntry = {
  readonly address: string;
  readonly id: string;
  readonly label: string;
  readonly networkId: StarknetNetworkId;
};

/**
 * Per-network custom RPC endpoints chosen by the user.
 */
export type RpcOverrides = Readonly<Partial<Record<StarknetNetworkId, string>>>;

/**
 * User-chosen account display names keyed by account id.
 */
export type AccountLabels = Readonly<Partial<Record<string, string>>>;

/**
 * Display currency for fiat values.
 */
export type DisplayCurrency = "eur" | "gbp" | "usd";

/**
 * Browser surface used for wallet approvals and toolbar activation.
 */
export type ApprovalSurfacePreference = "popup" | "side-panel";

/**
 * UI theme choice applied through the skin contract. `"dark"` and `"light"`
 * pin the two designed skins. `"system"` is a LEGACY stored value only — the
 * follow-the-browser theme was removed (its system-color neutrals broke the
 * designed surface tiers and failed contrast) — kept valid here so existing
 * vault backups and stored preferences never fail validation; the UI resolves
 * it to the default dark skin and no new writes produce it.
 */
export type ThemeChoice = "dark" | "light" | "system";

const isTokenSymbol = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z0-9]{2,12}$/.test(value);

/**
 * Shared 1-64 character trimmed-label rule reused for account and contact
 * labels.
 */
export const isLabel = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= 64;

const tokenId = (token: Omit<TokenConfig, "id">): string =>
  `${token.networkId}:${token.symbol}:${token.address}`;

const addressBookId = (entry: Omit<AddressBookEntry, "id">): string =>
  `${entry.networkId}:${entry.address}`;

/**
 * Derives the deterministic id for a token config from its network, symbol,
 * and address.
 */
export const withTokenId = (token: Omit<TokenConfig, "id">): TokenConfig => ({
  ...token,
  id: tokenId(token),
});

/**
 * Derives the deterministic id for an address-book entry from its network and
 * address.
 */
export const withAddressBookId = (entry: Omit<AddressBookEntry, "id">): AddressBookEntry => ({
  ...entry,
  id: addressBookId(entry),
});

/**
 * Validates a stored token config, including its derived id.
 */
export const isTokenConfig = (value: unknown): value is TokenConfig =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["address", "decimals", "id", "name", "networkId", "symbol"]) &&
  typeof value["address"] === "string" &&
  isNonZeroStarkFieldElement(value["address"]) &&
  isSafeDecimals(value["decimals"]) &&
  typeof value["id"] === "string" &&
  typeof value["name"] === "string" &&
  value["name"].trim().length > 0 &&
  value["name"].trim().length <= 64 &&
  isStarknetNetworkId(value["networkId"]) &&
  isTokenSymbol(value["symbol"]) &&
  value["id"] === `${value["networkId"]}:${value["symbol"]}:${value["address"]}`;

/**
 * Validates a stored address-book entry, including its derived id.
 */
export const isAddressBookEntry = (value: unknown): value is AddressBookEntry =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["address", "id", "label", "networkId"]) &&
  typeof value["address"] === "string" &&
  isNonZeroStarkFieldElement(value["address"]) &&
  typeof value["id"] === "string" &&
  isLabel(value["label"]) &&
  isStarknetNetworkId(value["networkId"]) &&
  value["id"] === `${value["networkId"]}:${value["address"]}`;

/**
 * Validates the account-labels map (account id keys, label values).
 */
export const isAccountLabels = (value: unknown): value is AccountLabels =>
  isRecord(value) &&
  Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && isAccountId(key) && isLabel(value[key]),
  );

/**
 * Checks a fiat display-currency choice.
 */
export const isDisplayCurrency = (value: unknown): value is DisplayCurrency =>
  value === "eur" || value === "gbp" || value === "usd";

/**
 * Checks a browser approval-surface choice.
 */
export const isApprovalSurfacePreference = (value: unknown): value is ApprovalSurfacePreference =>
  value === "popup" || value === "side-panel";

/**
 * Checks a UI theme choice. Accepts the legacy `"system"` value so stored
 * preferences and backups from before its removal keep validating.
 */
export const isThemeChoice = (value: unknown): value is ThemeChoice =>
  value === "dark" || value === "light" || value === "system";

/**
 * Checks a hidden-token id string.
 */
export const isTokenId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;

/**
 * Validates the hidden-tokens list.
 */
export const isHiddenTokens = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isTokenId) && hasUniqueStrings(value);

/**
 * Validates the per-network RPC override map.
 */
export const isRpcOverrides = (value: unknown): value is RpcOverrides =>
  isRecord(value) &&
  Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && isStarknetNetworkId(key) && isCustomRpcUrl(value[key]),
  );
