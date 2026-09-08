/**
 * Pure value types and validators for the plain preferences store's entry
 * collections — tokens, address-book contacts, account labels, hidden tokens,
 * RPC overrides — plus the small shared guards they lean on. Extracted from
 * `preferences-store.ts` so that file stays under the repository line cap; the
 * store re-exports the public types so existing import paths are unchanged.
 */
import {
  hasOnlyKnownKeys,
  hasUniqueStrings,
  isRecord,
  isSafeDecimals,
  isTokenSymbol,
} from "@bramble/core/json";
import { isAccountId } from "@bramble/wallet-model/accounts";
import {
  canonicalAddress,
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import { isNostrPublicKey } from "@bramble/wallet-model/nostr";
import { isCustomRpcUrl } from "../networks/custom-network";

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
  readonly nostrPublicKey?: string;
  readonly publicKeyX?: string;
};

/** Public contract and coordination identity carried by a shared wallet card. */
export type WalletContactCard = {
  readonly address: string;
  readonly networkId: StarknetNetworkId;
  readonly nostrPublicKey?: string;
  readonly publicKeyX?: string;
};

const CONTACT_CARD_PREFIX = "mcw:contact:1:";

/** Encodes one validated public wallet identity into a compact, QR-safe card. */
export const walletContactCard = (card: WalletContactCard): string => {
  const address = canonicalAddress(card.address);
  const publicKeyX = card.publicKeyX ? canonicalFelt(card.publicKeyX) : null;
  if (
    !address ||
    !isNonZeroStarkFieldElement(address) ||
    !isStarknetNetworkId(card.networkId) ||
    (card.publicKeyX !== undefined && (!publicKeyX || !isNonZeroStarkFieldElement(publicKeyX))) ||
    (card.nostrPublicKey !== undefined && !isNostrPublicKey(card.nostrPublicKey))
  ) {
    throw new Error("Invalid wallet contact card");
  }
  return `${CONTACT_CARD_PREFIX}${card.networkId}:${address.slice(2)}:${publicKeyX?.slice(2) ?? "-"}:${card.nostrPublicKey ?? "-"}`;
};

/** Parses an untrusted, versioned wallet contact card into canonical public data. */
export const parseWalletContactCard = (value: unknown): WalletContactCard | null => {
  if (typeof value !== "string" || value.length > 512 || !value.startsWith(CONTACT_CARD_PREFIX)) {
    return null;
  }
  const [networkId, addressHex, publicKeyHex, nostrPublicKey, ...rest] = value
    .slice(CONTACT_CARD_PREFIX.length)
    .split(":");
  const address = addressHex ? canonicalAddress(`0x${addressHex}`) : null;
  const publicKeyX =
    publicKeyHex && publicKeyHex !== "-" ? canonicalFelt(`0x${publicKeyHex}`) : null;
  if (
    rest.length > 0 ||
    !isStarknetNetworkId(networkId) ||
    !address ||
    !isNonZeroStarkFieldElement(address) ||
    (publicKeyHex !== "-" && (!publicKeyX || !isNonZeroStarkFieldElement(publicKeyX))) ||
    (nostrPublicKey !== "-" && !isNostrPublicKey(nostrPublicKey))
  ) {
    return null;
  }
  return {
    address,
    networkId,
    ...(nostrPublicKey === "-" ? {} : { nostrPublicKey }),
    ...(publicKeyX ? { publicKeyX } : {}),
  };
};

/**
 * Per-network custom RPC endpoints chosen by the user.
 */
export type RpcOverrides = Readonly<Partial<Record<StarknetNetworkId, string>>>;

/**
 * Per-network Starkscan-compatible explorer API bases chosen by the user.
 */
export type ExplorerApiOverrides = RpcOverrides;

/**
 * Per-network opt-in for the public explorer gateway read lane (MCW-V09-129).
 *
 * An entry is an explicit user choice about one network and always wins over
 * the derived default in {@link explorerFallbackAllowed}; a network with no
 * entry has never been decided by the user. `true` permits the wallet to ask a
 * third-party explorer for balances and transfer history *after* every
 * configured Starknet RPC has failed — which discloses the account address to
 * that explorer. `false` refuses the lane, so an RPC outage surfaces as an
 * error instead of a silent disclosure.
 */
export type ExplorerFallback = Readonly<Partial<Record<StarknetNetworkId, boolean>>>;

/**
 * The stored-preferences slice that decides whether the explorer gateway lane
 * may run for a network. Structural on purpose: the resolver is consumed from
 * `src/starknet`, which must not depend on the whole preferences record to
 * answer one question about one network.
 */
export type ExplorerLanePreferences = {
  readonly explorerApiUrls?: ExplorerApiOverrides;
  readonly explorerFallback?: ExplorerFallback;
  readonly rpcOverrides?: RpcOverrides;
};

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

/**
 * Shared 1-64 character trimmed-label rule reused for account and contact
 * labels.
 */
export const isLabel = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= 64;

// The address every entry id is built from. Canonicalizing HERE rather than at
// the call sites is the point: an id is only ever as unique as the spelling it
// interpolates, and two spellings of one address (0x49d3… and 0x049d3…) once
// produced two token records the private-balance read then refused as a
// duplicate. An address that is not a field element passes through unchanged so
// the entry validators below still reject it — this never widens what is valid.
const entryAddress = (address: string): string => canonicalAddress(address) ?? address;

/**
 * Spells a token config's id from its parts. The one place the
 * `network:symbol:address` shape exists: the write path, the stored-record
 * validator, the fee guard's synthetic STRK entry, and the popup's balance
 * reader all call this, so none of them can disagree about what a token's id
 * is. Takes the address as given — canonicalize it first (see
 * {@link withTokenId}); an id built from a non-canonical address is exactly the
 * duplicate this shape exists to prevent.
 */
export const tokenConfigId = (
  networkId: StarknetNetworkId,
  symbol: string,
  address: string,
): string => `${networkId}:${symbol}:${address}`;

/**
 * Spells an address-book entry's id from its parts, under the same
 * one-definition rule as {@link tokenConfigId}.
 */
export const addressBookEntryId = (networkId: StarknetNetworkId, address: string): string =>
  `${networkId}:${address}`;

/**
 * Derives the deterministic id for a token config from its network, symbol, and
 * canonical address, returning the entry with that canonical address in place.
 *
 * Every write path into the token collection goes through here, so the stored
 * address, the derived id, and any later comparison agree on one spelling. A
 * caller that hands in a non-canonical address gets a canonical record back
 * rather than a second record for a token the wallet already tracks.
 */
export const withTokenId = (token: Omit<TokenConfig, "id">): TokenConfig => {
  const address = entryAddress(token.address);
  return { ...token, address, id: tokenConfigId(token.networkId, token.symbol, address) };
};

/**
 * Derives the deterministic id for an address-book entry from its network and
 * canonical address, under the same one-spelling rule as {@link withTokenId}.
 * A contact re-saved in a different spelling replaces the stored one instead of
 * adding a near-duplicate to the set the address-poisoning guard compares
 * recipients against.
 */
export const withAddressBookId = (entry: Omit<AddressBookEntry, "id">): AddressBookEntry => {
  const address = entryAddress(entry.address);
  const { publicKeyX: inputPublicKeyX, ...contact } = entry;
  const publicKeyX = inputPublicKeyX && (canonicalFelt(inputPublicKeyX) ?? inputPublicKeyX);
  return {
    ...contact,
    address,
    id: addressBookEntryId(entry.networkId, address),
    ...(publicKeyX ? { publicKeyX } : {}),
  };
};

/**
 * Validates a stored token config, including its derived id and the strict
 * canonical spelling of its address. A record whose address is a valid felt in
 * a different spelling is rejected rather than accepted, so the "one record per
 * token per network" invariant is enforced by the type's own validator and not
 * only by call-site discipline. Stored records written before that rule are
 * normalized on read (see ./preferences-stored).
 */
export const isTokenConfig = (value: unknown): value is TokenConfig =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["address", "decimals", "id", "name", "networkId", "symbol"]) &&
  typeof value["address"] === "string" &&
  isNonZeroStarkFieldElement(value["address"]) &&
  canonicalAddress(value["address"]) === value["address"] &&
  isSafeDecimals(value["decimals"]) &&
  typeof value["id"] === "string" &&
  typeof value["name"] === "string" &&
  value["name"].trim().length > 0 &&
  value["name"].trim().length <= 64 &&
  isStarknetNetworkId(value["networkId"]) &&
  isTokenSymbol(value["symbol"]) &&
  value["id"] === tokenConfigId(value["networkId"], value["symbol"], value["address"]);

/**
 * Validates a stored address-book entry, including its derived id and the same
 * strict canonical address rule {@link isTokenConfig} applies.
 */
export const isAddressBookEntry = (value: unknown): value is AddressBookEntry =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "address",
    "id",
    "label",
    "networkId",
    "nostrPublicKey",
    "publicKeyX",
  ]) &&
  typeof value["address"] === "string" &&
  isNonZeroStarkFieldElement(value["address"]) &&
  canonicalAddress(value["address"]) === value["address"] &&
  typeof value["id"] === "string" &&
  isLabel(value["label"]) &&
  isStarknetNetworkId(value["networkId"]) &&
  (value["nostrPublicKey"] === undefined || isNostrPublicKey(value["nostrPublicKey"])) &&
  (value["publicKeyX"] === undefined ||
    (typeof value["publicKeyX"] === "string" &&
      isNonZeroStarkFieldElement(value["publicKeyX"]) &&
      canonicalFelt(value["publicKeyX"]) === value["publicKeyX"])) &&
  value["id"] === addressBookEntryId(value["networkId"], value["address"]);

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

/**
 * Validates the per-network explorer-fallback map. Only booleans are accepted,
 * so a record carrying anything else is rejected rather than coerced into an
 * accidental "yes" for a third-party disclosure.
 */
export const isExplorerFallback = (value: unknown): value is ExplorerFallback =>
  isRecord(value) &&
  Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && isStarknetNetworkId(key) && typeof value[key] === "boolean",
  );

/**
 * Decides whether the public explorer gateway may answer for `networkId` once
 * every configured Starknet RPC has failed.
 *
 * An explicit stored choice always wins. With no stored choice the default is
 * derived from the user's own endpoint configuration: a user on the built-in
 * RPCs keeps the outage rescue (`true`), while a user who set an `rpcOverride`
 * for that network gets `false` — configuring your own endpoint reads as a
 * deliberate decision that no third party should see your addresses, so an
 * outage must surface as an error rather than as a silent disclosure. Pure and
 * total: it never throws and never consults the network.
 */
export const explorerFallbackAllowed = (
  preferences: ExplorerLanePreferences,
  networkId: StarknetNetworkId,
): boolean =>
  preferences.explorerFallback?.[networkId] ?? preferences.rpcOverrides?.[networkId] === undefined;
