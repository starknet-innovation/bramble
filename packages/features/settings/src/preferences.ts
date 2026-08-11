/**
 * Plain wallet preferences kept outside the encrypted vault.
 */
import { WalletError } from "@mc-wallet/core/errors";
import { hasOnlyKnownKeys, hasUniqueStrings, isJson, isRecord } from "@mc-wallet/core/json";
import { isWatchedNft, withNftId } from "@mc-wallet/portfolio/watched-nft";
import {
  DEFAULT_STRK20_NETWORKS,
  isStrk20NetworkConfig,
  isStrk20NetworkConfigs,
  STRK20_MAINNET_POOL,
  type Strk20NetworkConfig,
} from "@mc-wallet/privacy/config";
import { assertStoreAccess, type StoreActor } from "@mc-wallet/store/access";
import type { KeyValueStore } from "@mc-wallet/store/kv";
import { serializeStoreMutations } from "@mc-wallet/store/mutation";
import { isAccountId } from "@mc-wallet/wallet-model/accounts";
import {
  isCustomNetwork,
  isCustomRpcUrl,
  normalizeChainId,
} from "@mc-wallet/wallet-model/custom-network";
import {
  DEFAULT_NETWORK,
  DEFAULT_TOKENS,
  isStarknetNetworkId,
  STRK_TOKEN_ADDRESS,
} from "@mc-wallet/wallet-model/networks";
import {
  isAccountLabels,
  isAddressBookEntry,
  isApprovalSurfacePreference,
  isDisplayCurrency,
  isHiddenTokens,
  isLabel,
  isRpcOverrides,
  isThemeChoice,
  isTokenConfig,
  isTokenId,
  withAddressBookId,
  withTokenId,
} from "@mc-wallet/wallet-model/preferences";
import {
  createGroup as createGroupPure,
  isAccountGroups,
  normalizeAccountGroups,
  removeGroup as removeGroupPure,
  renameGroup as renameGroupPure,
  setAccountInGroup as setAccountInGroupPure,
  setGroupIcon as setGroupIconPure,
} from "./groups";
import type { WalletPreferences, WalletPreferencesStore } from "./preferences-types";

/**
 * Re-exported entry types so callers keep importing them from this store.
 */
export type {
  AccountLabels,
  AddressBookEntry,
  ApprovalSurfacePreference,
  DisplayCurrency,
  RpcOverrides,
  ThemeChoice,
  TokenConfig,
} from "@mc-wallet/wallet-model/preferences";
/**
 * Re-exported store schema and capability types.
 */
export type {
  WalletPreferences,
  WalletPreferencesStore,
} from "./preferences-types";

/**
 * Browser storage key for non-secret wallet preferences.
 */
export const PREFERENCES_STORE_KEY = "mc-wallet:preferences";

type WalletPreferencesStoreOptions = {
  readonly actor?: StoreActor;
  readonly store: KeyValueStore;
};

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
 * Checks stored plain preferences before use.
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

/**
 * Creates default non-secret wallet preferences.
 */
export const defaultWalletPreferences = (): WalletPreferences => ({
  accountLabels: {},
  activeNetworkId: DEFAULT_NETWORK.id,
  approvalSurface: "side-panel",
  addressBook: [],
  customNetworks: [],
  displayCurrency: "usd",
  groups: [],
  hiddenTokens: [],
  nfts: [],
  rpcOverrides: {},
  schemaVersion: 1,
  strk20Networks: DEFAULT_STRK20_NETWORKS,
  theme: "dark",
  tokens: DEFAULT_TOKENS.map(withTokenId),
});

const RETIRED_STRK20_GATEWAY_BASE = "https://mc-wallet-terminal.vercel.app/api/strk20";

// The old bundled Mainnet snapshot is the only configuration rebased on read.
// Requiring every default field preserves custom routing and an empty-map opt-out.
const isRetiredBundledMainnetRouting = (config: Strk20NetworkConfig | undefined): boolean =>
  config !== undefined &&
  config.discoveryUrl === `${RETIRED_STRK20_GATEWAY_BASE}/discovery` &&
  config.ohttpEnabled === true &&
  config.ohttpRelayUrl === undefined &&
  config.paymaster?.feeToken === STRK_TOKEN_ADDRESS &&
  config.paymaster.url === `${RETIRED_STRK20_GATEWAY_BASE}/paymaster` &&
  config.poolAddress === STRK20_MAINNET_POOL &&
  config.proverUrl === `${RETIRED_STRK20_GATEWAY_BASE}/prover` &&
  config.subaccountAnonymizerAddress === undefined;

const withCurrentStrk20Defaults = (preferences: WalletPreferences): WalletPreferences => {
  if (preferences.strk20Networks === undefined) {
    return { ...preferences, strk20Networks: DEFAULT_STRK20_NETWORKS };
  }
  if (!isRetiredBundledMainnetRouting(preferences.strk20Networks.SN_MAIN)) {
    return preferences;
  }
  return {
    ...preferences,
    strk20Networks: { ...preferences.strk20Networks, ...DEFAULT_STRK20_NETWORKS },
  };
};

const writePreferences = async (
  store: KeyValueStore,
  preferences: WalletPreferences,
): Promise<void> => {
  if (!isWalletPreferences(preferences) || !isJson(preferences)) {
    throw new WalletError("Invalid preferences");
  }
  await store.set(PREFERENCES_STORE_KEY, preferences);
};

/**
 * Creates the plain preferences store with capability checks.
 */
export const createPreferencesStore = ({
  actor = "background",
  store,
}: WalletPreferencesStoreOptions): WalletPreferencesStore => {
  assertStoreAccess("preferences", actor);

  const read = async (): Promise<WalletPreferences> => {
    const stored = await store.get(PREFERENCES_STORE_KEY);
    if (stored === undefined) {
      return defaultWalletPreferences();
    }
    if (!isWalletPreferences(stored)) {
      throw new WalletError("Invalid stored preferences");
    }
    const withPrivacyDefaults = withCurrentStrk20Defaults(stored);
    // Self-heal legacy multi-group membership on read (the validator stays
    // permissive so old data loads rather than erroring): collapse each account
    // to a single folder so every consumer sees the single-group invariant.
    if (withPrivacyDefaults.groups === undefined) {
      return withPrivacyDefaults;
    }
    const groups = normalizeAccountGroups(withPrivacyDefaults.groups);
    return groups === withPrivacyDefaults.groups
      ? withPrivacyDefaults
      : { ...withPrivacyDefaults, groups };
  };

  return serializeStoreMutations<WalletPreferencesStore>(
    {
      async addCustomNetwork(network) {
        if (!isCustomNetwork(network)) {
          throw new WalletError("Invalid custom network");
        }
        const preferences = await read();
        const key = normalizeChainId(network.chainId);
        const existing = (preferences.customNetworks ?? []).filter(
          (stored) => normalizeChainId(stored.chainId) !== key,
        );
        const next = { ...preferences, customNetworks: [...existing, network] };
        await writePreferences(store, next);
        return next;
      },
      async addNft(nft) {
        const nextNft = withNftId(nft);
        if (!isWatchedNft(nextNft)) {
          throw new WalletError("Invalid NFT");
        }
        const preferences = await read();
        const nfts = (preferences.nfts ?? []).filter((stored) => stored.id !== nextNft.id);
        const next = { ...preferences, nfts: [...nfts, nextNft] };
        await writePreferences(store, next);
        return next;
      },
      async createGroup({ icon, name }) {
        const preferences = await read();
        const next = {
          ...preferences,
          groups: createGroupPure(preferences.groups ?? [], name, icon),
        };
        await writePreferences(store, next);
        return next;
      },
      async importPreferences(candidate) {
        if (!isWalletPreferences(candidate)) {
          throw new WalletError("Invalid preferences backup");
        }
        await writePreferences(store, candidate);
        return candidate;
      },
      read,
      async removeAddress(id) {
        if (typeof id !== "string" || id.length === 0) {
          throw new WalletError("Invalid address book entry");
        }
        const preferences = await read();
        const next = {
          ...preferences,
          addressBook: preferences.addressBook.filter((stored) => stored.id !== id),
        };
        await writePreferences(store, next);
        return next;
      },
      async removeGroup({ id }) {
        const preferences = await read();
        const next = { ...preferences, groups: removeGroupPure(preferences.groups ?? [], id) };
        await writePreferences(store, next);
        return next;
      },
      async removeNft(id) {
        if (typeof id !== "string" || id.length === 0) {
          throw new WalletError("Invalid NFT");
        }
        const preferences = await read();
        const next = {
          ...preferences,
          nfts: (preferences.nfts ?? []).filter((stored) => stored.id !== id),
        };
        await writePreferences(store, next);
        return next;
      },
      async renameGroup({ id, name }) {
        const preferences = await read();
        const next = {
          ...preferences,
          groups: renameGroupPure(preferences.groups ?? [], id, name),
        };
        await writePreferences(store, next);
        return next;
      },
      async setAccountInGroup({ accountId, groupId, member }) {
        const preferences = await read();
        const next = {
          ...preferences,
          groups: setAccountInGroupPure(preferences.groups ?? [], groupId, accountId, member),
        };
        await writePreferences(store, next);
        return next;
      },
      async setGroupIcon({ icon, id }) {
        const preferences = await read();
        const next = {
          ...preferences,
          groups: setGroupIconPure(preferences.groups ?? [], id, icon),
        };
        await writePreferences(store, next);
        return next;
      },
      async setNftSpam({ id, spam }) {
        if (typeof id !== "string" || id.length === 0) {
          throw new WalletError("Invalid NFT");
        }
        const preferences = await read();
        const next = {
          ...preferences,
          nfts: (preferences.nfts ?? []).map((stored) =>
            stored.id === id ? { ...stored, spam } : stored,
          ),
        };
        await writePreferences(store, next);
        return next;
      },
      async setAccountLabel({ accountId, label }) {
        if (!isAccountId(accountId)) {
          throw new WalletError("Invalid account id");
        }
        const trimmed = label.trim();
        if (trimmed.length > 0 && !isLabel(trimmed)) {
          throw new WalletError("Invalid account label");
        }
        const preferences = await read();
        const labels = { ...preferences.accountLabels };
        if (trimmed.length === 0) {
          delete labels[accountId];
        } else {
          labels[accountId] = trimmed;
        }
        const next = { ...preferences, accountLabels: labels };
        await writePreferences(store, next);
        return next;
      },
      async setDisplay(input) {
        if (
          (input.approvalSurface !== undefined &&
            !isApprovalSurfacePreference(input.approvalSurface)) ||
          (input.displayCurrency !== undefined && !isDisplayCurrency(input.displayCurrency)) ||
          (input.theme !== undefined && !isThemeChoice(input.theme))
        ) {
          throw new WalletError("Invalid display preference");
        }
        const preferences = await read();
        const next = {
          ...preferences,
          ...(input.approvalSurface === undefined
            ? {}
            : { approvalSurface: input.approvalSurface }),
          ...(input.displayCurrency === undefined
            ? {}
            : { displayCurrency: input.displayCurrency }),
          ...(input.theme === undefined ? {} : { theme: input.theme }),
        };
        await writePreferences(store, next);
        return next;
      },
      async saveAddress(entry) {
        const nextEntry = withAddressBookId({ ...entry, label: entry.label.trim() });
        if (!isAddressBookEntry(nextEntry)) {
          throw new WalletError("Invalid address book entry");
        }
        const preferences = await read();
        const entries = preferences.addressBook.filter((stored) => stored.id !== nextEntry.id);
        const next = { ...preferences, addressBook: [...entries, nextEntry] };
        await writePreferences(store, next);
        return next;
      },
      async setRpcOverride({ networkId, rpcUrl }) {
        if (!isStarknetNetworkId(networkId)) {
          throw new WalletError("Invalid Starknet network");
        }
        const trimmed = rpcUrl.trim();
        if (trimmed.length > 0 && !isCustomRpcUrl(trimmed)) {
          throw new WalletError("Invalid RPC endpoint");
        }
        const preferences = await read();
        const overrides = { ...preferences.rpcOverrides };
        if (trimmed.length === 0) {
          delete overrides[networkId];
        } else {
          overrides[networkId] = trimmed;
        }
        const next = { ...preferences, rpcOverrides: overrides };
        await writePreferences(store, next);
        return next;
      },
      async setNftIndexerUrl({ url }) {
        const trimmed = url.trim();
        if (trimmed.length > 0 && !isCustomRpcUrl(trimmed)) {
          throw new WalletError("Invalid indexer endpoint");
        }
        const preferences = await read();
        const next = { ...preferences };
        if (trimmed.length === 0) {
          delete (next as { nftIndexerUrl?: string }).nftIndexerUrl;
        } else {
          (next as { nftIndexerUrl?: string }).nftIndexerUrl = trimmed;
        }
        await writePreferences(store, next);
        return next;
      },
      async setStrk20NetworkConfig({ config, networkId }) {
        if (
          !isStarknetNetworkId(networkId) ||
          (config !== null && !isStrk20NetworkConfig(config))
        ) {
          throw new WalletError("Invalid STRK20 network configuration");
        }
        const preferences = await read();
        const strk20Networks = { ...preferences.strk20Networks };
        if (config === null) {
          delete strk20Networks[networkId];
        } else {
          strk20Networks[networkId] = config;
        }
        const next = { ...preferences, strk20Networks };
        await writePreferences(store, next);
        return next;
      },
      async setActiveNetwork(networkId) {
        if (!isStarknetNetworkId(networkId)) {
          throw new WalletError("Invalid Starknet network");
        }
        const next = { ...(await read()), activeNetworkId: networkId };
        await writePreferences(store, next);
        return next;
      },
      async setTokenHidden({ hidden, tokenId }) {
        if (!isTokenId(tokenId)) {
          throw new WalletError("Invalid token");
        }
        const preferences = await read();
        const current = preferences.hiddenTokens ?? [];
        const hiddenTokens = hidden
          ? [...new Set([...current, tokenId])]
          : current.filter((stored) => stored !== tokenId);
        const next = { ...preferences, hiddenTokens };
        await writePreferences(store, next);
        return next;
      },
      async upsertToken(token) {
        const nextToken = withTokenId(token);
        if (!isTokenConfig(nextToken)) {
          throw new WalletError("Invalid token");
        }
        const preferences = await read();
        const tokens = preferences.tokens.filter((stored) => stored.id !== nextToken.id);
        const next = { ...preferences, tokens: [...tokens, nextToken] };
        await writePreferences(store, next);
        return next;
      },
    },
    ["read"],
  );
};
