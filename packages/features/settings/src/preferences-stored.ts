/**
 * The stored shape of plain wallet preferences: the validator that decides
 * whether a persisted record may be trusted, and the deterministic
 * normalization applied to a record written by an older build before that
 * validator runs.
 *
 * Split from `preferences-store.ts` so the store file stays under the
 * repository line cap and so "what a stored record must look like" lives next
 * to "how a legacy record is brought to that shape" rather than inside the
 * mutation surface. The trust scope a preferences *backup* may restore lives
 * here for the same reason: it is a statement about which stored fields an
 * untrusted file is allowed to reach, not about how any one entry is shaped.
 */
import { hasOnlyKnownKeys, hasUniqueStrings, isJson, isRecord } from "@mc-wallet/core/json";
import { isWatchedNft } from "@mc-wallet/portfolio/watched-nft";
import { isStrk20NetworkConfigs } from "@mc-wallet/privacy/config";
import { canonicalAccountId } from "@mc-wallet/wallet-model/accounts";
import {
  isCustomNetwork,
  isCustomRpcUrl,
  normalizeChainId,
} from "@mc-wallet/wallet-model/custom-network";
import {
  canonicalAddress,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";
import { isNostrRelayUrl } from "@mc-wallet/wallet-model/nostr";
import {
  type AccountLabels,
  type AddressBookEntry,
  type DisplayCurrency,
  isAccountLabels,
  isAddressBookEntry,
  isApprovalSurfacePreference,
  isDisplayCurrency,
  isExplorerFallback,
  isHiddenTokens,
  isRpcOverrides,
  isThemeChoice,
  isTokenConfig,
  type ThemeChoice,
  type TokenConfig,
  withAddressBookId,
  withTokenId,
} from "@mc-wallet/wallet-model/preferences";
import { type AccountGroups, isAccountGroups } from "./groups";
import type { WalletPreferences } from "./preferences-types";

const PREFERENCE_KEYS: readonly string[] = [
  "accountLabels",
  "activeNetworkId",
  "approvalSurface",
  "addressBook",
  "customNetworks",
  "displayCurrency",
  "explorerApiUrls",
  "explorerFallback",
  "groups",
  "hiddenTokens",
  "nftIndexerUrl",
  "nfts",
  "nostrRelayUrl",
  "rpcOverrides",
  "reliabilityDiagnostics",
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
  (value["explorerApiUrls"] === undefined || isRpcOverrides(value["explorerApiUrls"])) &&
  (value["explorerFallback"] === undefined || isExplorerFallback(value["explorerFallback"])) &&
  (value["groups"] === undefined || isAccountGroups(value["groups"])) &&
  (value["hiddenTokens"] === undefined || isHiddenTokens(value["hiddenTokens"])) &&
  (value["nostrRelayUrl"] === undefined || isNostrRelayUrl(value["nostrRelayUrl"])) &&
  (value["reliabilityDiagnostics"] === undefined ||
    typeof value["reliabilityDiagnostics"] === "boolean") &&
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
        ...(typeof value["nostrPublicKey"] === "string"
          ? { nostrPublicKey: value["nostrPublicKey"] }
          : {}),
        ...(typeof value["publicKeyX"] === "string" ? { publicKeyX: value["publicKeyX"] } : {}),
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

const normalizedAccountLabels = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value;
  }
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const accountId = canonicalAccountId(key) ?? key;
    if (!Object.hasOwn(normalized, accountId)) {
      normalized[accountId] = value[key];
    }
  }
  return normalized;
};

const normalizedAccountGroups = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map((group) =>
        isRecord(group) && Array.isArray(group["accountIds"])
          ? {
              ...group,
              accountIds: [
                ...new Set(
                  group["accountIds"].map(
                    (accountId) => canonicalAccountId(accountId) ?? accountId,
                  ),
                ),
              ],
            }
          : group,
      )
    : value;

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
  const hasAccountAliases = value["accountLabels"] !== undefined || value["groups"] !== undefined;
  if (!tokens && !addressBook && !hasAccountAliases) {
    return value;
  }
  return {
    ...value,
    ...(value["accountLabels"] === undefined
      ? {}
      : { accountLabels: normalizedAccountLabels(value["accountLabels"]) }),
    ...(value["groups"] === undefined ? {} : { groups: normalizedAccountGroups(value["groups"]) }),
    ...(addressBook ? { addressBook: addressBook.entries } : {}),
    ...(tokens
      ? { ...remapHiddenTokens(value["hiddenTokens"], tokens.renames), tokens: tokens.entries }
      : {}),
  };
};

/**
 * The organisational slice of stored preferences: naming, grouping, display,
 * and the selected network. This is the ONLY part of a preferences backup a
 * restore is allowed to apply.
 *
 * Deliberately excluded — and therefore never restorable from a file — is
 * every trust-bearing field the transaction-review layer reads as ground
 * truth: `tokens` (decimals and symbols behind amount formatting and the
 * unknown-contract warning), `rpcOverrides`, `explorerApiUrls`, `customNetworks`,
 * `nftIndexerUrl`, `nfts`, `nostrRelayUrl`, `strk20Networks`, `strk20ProverUrl`, and
 * `approvalSurface`. `explorerFallback` is excluded for the same reason: a
 * file that flipped it to `true` would re-arm a third-party address disclosure
 * the user had switched off, and one that flipped it to `false` would turn an
 * RPC outage into an unexplained failure.
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
