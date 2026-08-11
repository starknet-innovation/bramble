/**
 * Pure value types and validators for the plain preferences store's entry
 * collections — tokens, address-book contacts, account labels, hidden tokens,
 * RPC overrides — plus the small shared guards they lean on, and the trust
 * scope a preferences backup is allowed to restore. Extracted from
 * `preferences-store.ts` so that file stays under the repository line cap; the
 * store re-exports the public types so existing import paths are unchanged.
 */
import {
  hasOnlyKnownKeys,
  hasUniqueStrings,
  isRecord,
  isSafeDecimals,
  isTokenSymbol,
} from "../shared/json";
import {
  canonicalAddress,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "../starknet/networks";
import type { AccountGroups } from "./account-groups";
import { isCustomRpcUrl } from "./custom-network";
import { isAccountId } from "./vault-schema";

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
  return { ...entry, address, id: addressBookEntryId(entry.networkId, address) };
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
  hasOnlyKnownKeys(value, ["address", "id", "label", "networkId"]) &&
  typeof value["address"] === "string" &&
  isNonZeroStarkFieldElement(value["address"]) &&
  canonicalAddress(value["address"]) === value["address"] &&
  typeof value["id"] === "string" &&
  isLabel(value["label"]) &&
  isStarknetNetworkId(value["networkId"]) &&
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
 * The organisational slice of stored preferences: naming, grouping, display,
 * and the selected network. This is the ONLY part of a preferences backup a
 * restore is allowed to apply.
 *
 * Deliberately excluded — and therefore never restorable from a file — is
 * every trust-bearing field the transaction-review layer reads as ground
 * truth: `tokens` (decimals and symbols behind amount formatting and the
 * unknown-contract warning), `rpcOverrides`, `customNetworks`,
 * `nftIndexerUrl`, `nfts`, `strk20Networks`, `strk20ProverUrl`, and
 * `approvalSurface`.
 *
 * `addressBook` is excluded too, in both directions. The saved contacts are
 * the reference set behind the address-poisoning guard, so a file that
 * replaced them would silently disarm that check for exactly the recipients
 * the user really sends to; and an entry a file *added* would render as a
 * one-tap recipient in every send picker under a label the user never chose.
 * A restore therefore leaves the stored contacts byte-for-byte alone —
 * contacts are added only through `saveAddress`, which is an explicit,
 * per-contact user action. Restoring contacts from a file needs a per-entry
 * confirmation surface that does not exist yet; until it does, silence is the
 * safe answer.
 */
export type ImportablePreferences = {
  readonly accountLabels?: AccountLabels;
  readonly activeNetworkId: StarknetNetworkId;
  readonly displayCurrency?: DisplayCurrency;
  readonly groups?: AccountGroups;
  readonly hiddenTokens?: readonly string[];
  readonly theme?: ThemeChoice;
};

/**
 * Narrows an already-validated preferences backup to the fields a restore may
 * apply, so the caller can merge it over the stored preferences without any
 * trust-bearing field crossing the boundary. A backup file is untrusted input:
 * unlisted fields are dropped rather than merged, so a hostile file cannot
 * repoint RPC, indexer, or privacy-service endpoints, redefine token metadata,
 * move approvals to another surface, or delete, relabel, or plant an
 * address-book contact.
 *
 * Optional fields absent from the backup are omitted rather than written as
 * `undefined`, so the stored value survives the merge and the merged record
 * stays JSON-serializable for the storage validator. Never returns secret
 * material; it only forwards values the caller already validated.
 */
export const pickImportablePreferences = (
  backup: ImportablePreferences,
): ImportablePreferences => ({
  activeNetworkId: backup.activeNetworkId,
  ...(backup.accountLabels === undefined ? {} : { accountLabels: backup.accountLabels }),
  ...(backup.displayCurrency === undefined ? {} : { displayCurrency: backup.displayCurrency }),
  ...(backup.groups === undefined ? {} : { groups: backup.groups }),
  ...(backup.hiddenTokens === undefined ? {} : { hiddenTokens: backup.hiddenTokens }),
  ...(backup.theme === undefined ? {} : { theme: backup.theme }),
});
