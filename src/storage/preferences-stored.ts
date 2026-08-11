/**
 * The stored shape of plain wallet preferences: the validator that decides
 * whether a persisted record may be trusted, and the deterministic
 * normalization applied to a record written by an older build before that
 * validator runs.
 *
 * Split from `preferences-store.ts` so the store file stays under the
 * repository line cap and so "what a stored record must look like" lives next
 * to "how a legacy record is brought to that shape" rather than inside the
 * mutation surface.
 */
import { hasOnlyKnownKeys, hasUniqueStrings, isJson, isRecord } from "../shared/json";
import { canonicalAddress, isStarknetNetworkId } from "../starknet/networks";
import { isStrk20NetworkConfigs } from "../starknet/strk20/config";
import { isAccountGroups } from "./account-groups";
import { isCustomNetwork, isCustomRpcUrl, normalizeChainId } from "./custom-network";
import { isWatchedNft } from "./nft";
import {
  type AddressBookEntry,
  isAccountLabels,
  isAddressBookEntry,
  isApprovalSurfacePreference,
  isDisplayCurrency,
  isHiddenTokens,
  isRpcOverrides,
  isThemeChoice,
  isTokenConfig,
  type TokenConfig,
  withAddressBookId,
  withTokenId,
} from "./preferences-entries";
import type { WalletPreferences } from "./preferences-store-types";

const PREFERENCE_KEYS: readonly string[] = [
  "accountLabels",
  "activeNetworkId",
  "approvalSurface",
  "addressBook",
  "customNetworks",
  "displayCurrency",
  "groups",
  "hiddenTokens",
  "nftIndexerUrl",
  "nfts",
  "rpcOverrides",
  "schemaVersion",
  "strk20Networks",
  "strk20ProverUrl",
  "theme",
  "tokens",
];

// Optional-section guards, each pure, keeping the main guard a single `&&` chain.
const hasValidCustomNetworks = (value: Record<string, unknown>): boolean =>
  value["customNetworks"] === undefined ||
  (Array.isArray(value["customNetworks"]) &&
    value["customNetworks"].every(isCustomNetwork) &&
    hasUniqueStrings(value["customNetworks"].map((network) => normalizeChainId(network.chainId))));
const hasValidOptionalEntries = (value: Record<string, unknown>): boolean =>
  (value["accountLabels"] === undefined || isAccountLabels(value["accountLabels"])) &&
  (value["approvalSurface"] === undefined ||
    isApprovalSurfacePreference(value["approvalSurface"])) &&
  (value["displayCurrency"] === undefined || isDisplayCurrency(value["displayCurrency"])) &&
  (value["groups"] === undefined || isAccountGroups(value["groups"])) &&
  (value["hiddenTokens"] === undefined || isHiddenTokens(value["hiddenTokens"])) &&
  (value["theme"] === undefined || isThemeChoice(value["theme"])) &&
  (value["rpcOverrides"] === undefined || isRpcOverrides(value["rpcOverrides"]));
const hasValidUrlAndNftFields = (value: Record<string, unknown>): boolean =>
  (value["strk20ProverUrl"] === undefined ||
    (typeof value["strk20ProverUrl"] === "string" && isCustomRpcUrl(value["strk20ProverUrl"]))) &&
  (value["strk20Networks"] === undefined || isStrk20NetworkConfigs(value["strk20Networks"])) &&
  (value["nftIndexerUrl"] === undefined ||
    (typeof value["nftIndexerUrl"] === "string" && isCustomRpcUrl(value["nftIndexerUrl"]))) &&
  (value["nfts"] === undefined ||
    (Array.isArray(value["nfts"]) &&
      value["nfts"].every(isWatchedNft) &&
      hasUniqueStrings(value["nfts"].map((nft) => nft.id))));

/**
 * Checks stored plain preferences before use. Every entry collection must carry
 * canonical addresses and unique derived ids; a record that predates that rule
 * is brought to it by {@link normalizeStoredPreferences} first, so reaching this
 * guard with a duplicate is a genuine integrity failure rather than history.
 */
export const isWalletPreferences = (value: unknown): value is WalletPreferences =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, PREFERENCE_KEYS) &&
  hasValidCustomNetworks(value) &&
  hasValidOptionalEntries(value) &&
  hasValidUrlAndNftFields(value) &&
  value["schemaVersion"] === 1 &&
  isStarknetNetworkId(value["activeNetworkId"]) &&
  Array.isArray(value["addressBook"]) &&
  value["addressBook"].every(isAddressBookEntry) &&
  hasUniqueStrings(value["addressBook"].map((entry) => entry.id)) &&
  Array.isArray(value["tokens"]) &&
  value["tokens"].every(isTokenConfig) &&
  hasUniqueStrings(value["tokens"].map((token) => token.id));

const previousIdOf = (value: unknown): string | null =>
  isRecord(value) && typeof value["id"] === "string" ? value["id"] : null;

const rebuiltToken = (value: unknown): TokenConfig | null =>
  isRecord(value) &&
  typeof value["address"] === "string" &&
  typeof value["decimals"] === "number" &&
  typeof value["name"] === "string" &&
  isStarknetNetworkId(value["networkId"]) &&
  typeof value["symbol"] === "string"
    ? withTokenId({
        address: value["address"],
        decimals: value["decimals"],
        name: value["name"],
        networkId: value["networkId"],
        symbol: value["symbol"],
      })
    : null;

const rebuiltContact = (value: unknown): AddressBookEntry | null =>
  isRecord(value) &&
  typeof value["address"] === "string" &&
  typeof value["label"] === "string" &&
  isStarknetNetworkId(value["networkId"])
    ? withAddressBookId({
        address: value["address"],
        label: value["label"],
        networkId: value["networkId"],
      })
    : null;

// Two records collapse when they name the same address on the same network,
// compared numerically through the shared canonicalizer — that is exactly the
// pair a stored 0x49d3…/0x049d3… duplicate forms, and exactly the pair the
// private-balance read refuses to serve. The first occurrence wins so the
// result is deterministic and the seeded/curated record survives a later
// hand-typed one.
const collapseKey = (entry: { readonly address: string; readonly networkId: string }): string =>
  `${entry.networkId}\u0000${canonicalAddress(entry.address) ?? entry.address}`;

type RebuiltCollection = {
  readonly entries: readonly unknown[];
  readonly renames: ReadonlyMap<string, string>;
};

type RebuiltEntry = {
  readonly address: string;
  readonly id: string;
  readonly networkId: string;
};

const rebuildCollection = (
  value: unknown,
  rebuild: (entry: unknown) => RebuiltEntry | null,
): RebuiltCollection | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries: unknown[] = [];
  const renames = new Map<string, string>();
  const kept = new Map<string, string>();
  for (const original of value as readonly unknown[]) {
    const rebuiltEntry = rebuild(original);
    if (!rebuiltEntry) {
      // Left exactly as stored: an entry this build cannot read is the
      // validator's business, never something normalization invents a shape for.
      entries.push(original);
      continue;
    }
    const previousId = previousIdOf(original);
    const key = collapseKey(rebuiltEntry);
    const survivor = kept.get(key);
    if (survivor !== undefined) {
      if (previousId !== null) {
        renames.set(previousId, survivor);
      }
      continue;
    }
    kept.set(key, rebuiltEntry.id);
    if (previousId !== null && previousId !== rebuiltEntry.id) {
      renames.set(previousId, rebuiltEntry.id);
    }
    entries.push(rebuiltEntry);
  }
  return { entries, renames };
};

// Only rewritten when the stored field is actually a list; an absent
// hiddenTokens must stay absent rather than becoming an explicit `undefined`
// the JSON guard would then reject.
const remapHiddenTokens = (
  value: unknown,
  renames: ReadonlyMap<string, string>,
): { readonly hiddenTokens: readonly unknown[] } | Record<string, never> =>
  Array.isArray(value)
    ? {
        hiddenTokens: [
          ...new Set(
            (value as readonly unknown[]).map((id) =>
              typeof id === "string" ? (renames.get(id) ?? id) : id,
            ),
          ),
        ],
      }
    : {};

/**
 * Brings a stored preferences record to the current entry shape without any
 * user action: token and contact addresses are canonicalized, ids re-derived
 * from them, and records that name the same address on the same network are
 * collapsed to one — carrying hidden-token ids across the rename so a token
 * hidden before the collapse stays hidden.
 *
 * Deterministic and total: a non-record value, or a collection this build
 * cannot read, is returned untouched for {@link isWalletPreferences} to reject.
 * Nothing here widens what validates; it only repairs records an earlier build
 * wrote in a second spelling, whose duplicate otherwise left the private
 * balance surface permanently unreadable with no in-product way out.
 */
export const normalizeStoredPreferences = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value;
  }
  const tokens = rebuildCollection(value["tokens"], rebuiltToken);
  const addressBook = rebuildCollection(value["addressBook"], rebuiltContact);
  if (!tokens && !addressBook) {
    return value;
  }
  return {
    ...value,
    ...(addressBook ? { addressBook: addressBook.entries } : {}),
    ...(tokens
      ? { ...remapHiddenTokens(value["hiddenTokens"], tokens.renames), tokens: tokens.entries }
      : {}),
  };
};
