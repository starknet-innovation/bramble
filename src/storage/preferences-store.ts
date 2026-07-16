/**
 * Plain wallet preferences kept outside the encrypted vault.
 */
import { WalletError } from "../shared/errors";
import { hasOnlyKnownKeys, hasUniqueStrings, isJson, isRecord } from "../shared/json";
import {
  DEFAULT_NETWORK,
  DEFAULT_TOKENS,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "../starknet/networks";
import {
  type AccountGroupIcon,
  type AccountGroups,
  createGroup as createGroupPure,
  isAccountGroups,
  normalizeAccountGroups,
  removeGroup as removeGroupPure,
  renameGroup as renameGroupPure,
  setAccountInGroup as setAccountInGroupPure,
  setGroupIcon as setGroupIconPure,
} from "./account-groups";
import {
  type CustomNetwork,
  isCustomNetwork,
  isCustomRpcUrl,
  normalizeChainId,
} from "./custom-network";
import type { KeyValueStore } from "./kv";
import { isWatchedNft, type WatchedNft, withNftId } from "./nft";
import { assertStoreAccess, type StoreActor } from "./permissioned-store";
import {
  type AccountLabels,
  type AddressBookEntry,
  type DisplayCurrency,
  isAccountLabels,
  isAddressBookEntry,
  isDisplayCurrency,
  isHiddenTokens,
  isLabel,
  isRpcOverrides,
  isThemeChoice,
  isTokenConfig,
  isTokenId,
  type RpcOverrides,
  type ThemeChoice,
  type TokenConfig,
  withAddressBookId,
  withTokenId,
} from "./preferences-entries";
import { isAccountId } from "./vault-schema";

/**
 * Re-exported entry types so callers keep importing them from this store.
 */
export type {
  AccountLabels,
  AddressBookEntry,
  DisplayCurrency,
  RpcOverrides,
  ThemeChoice,
  TokenConfig,
} from "./preferences-entries";

/**
 * Browser storage key for non-secret wallet preferences.
 */
export const PREFERENCES_STORE_KEY = "mc-wallet:preferences";

/**
 * Current plain preferences schema. Optional fields keep preferences stored
 * before they existed validating; `groups` is one such field.
 */
export type WalletPreferences = {
  readonly accountLabels?: AccountLabels;
  readonly activeNetworkId: StarknetNetworkId;
  readonly addressBook: readonly AddressBookEntry[];
  readonly customNetworks?: readonly CustomNetwork[];
  readonly displayCurrency?: DisplayCurrency;
  readonly groups?: AccountGroups;
  readonly hiddenTokens?: readonly string[];
  readonly nftIndexerUrl?: string;
  readonly nfts?: readonly WatchedNft[];
  readonly rpcOverrides?: RpcOverrides;
  readonly schemaVersion: 1;
  readonly strk20ProverUrl?: string;
  readonly theme?: ThemeChoice;
  readonly tokens: readonly TokenConfig[];
};

/**
 * Plain preferences store methods exposed to the background worker.
 */
export type WalletPreferencesStore = {
  readonly addCustomNetwork: (network: CustomNetwork) => Promise<WalletPreferences>;
  readonly addNft: (nft: Omit<WatchedNft, "id">) => Promise<WalletPreferences>;
  readonly createGroup: (input: {
    readonly icon: AccountGroupIcon;
    readonly name: string;
  }) => Promise<WalletPreferences>;
  readonly importPreferences: (candidate: unknown) => Promise<WalletPreferences>;
  readonly read: () => Promise<WalletPreferences>;
  readonly removeAddress: (id: string) => Promise<WalletPreferences>;
  readonly removeGroup: (input: { readonly id: string }) => Promise<WalletPreferences>;
  readonly removeNft: (id: string) => Promise<WalletPreferences>;
  readonly renameGroup: (input: {
    readonly id: string;
    readonly name: string;
  }) => Promise<WalletPreferences>;
  readonly saveAddress: (entry: Omit<AddressBookEntry, "id">) => Promise<WalletPreferences>;
  readonly setAccountInGroup: (input: {
    readonly accountId: string;
    readonly groupId: string;
    readonly member: boolean;
  }) => Promise<WalletPreferences>;
  readonly setGroupIcon: (input: {
    readonly icon: AccountGroupIcon;
    readonly id: string;
  }) => Promise<WalletPreferences>;
  readonly setNftIndexerUrl: (input: { readonly url: string }) => Promise<WalletPreferences>;
  readonly setNftSpam: (input: {
    readonly id: string;
    readonly spam: boolean;
  }) => Promise<WalletPreferences>;
  readonly setAccountLabel: (input: {
    readonly accountId: string;
    readonly label: string;
  }) => Promise<WalletPreferences>;
  readonly setActiveNetwork: (networkId: StarknetNetworkId) => Promise<WalletPreferences>;
  readonly setDisplay: (input: {
    readonly displayCurrency?: DisplayCurrency;
    readonly theme?: ThemeChoice;
  }) => Promise<WalletPreferences>;
  readonly setRpcOverride: (input: {
    readonly networkId: StarknetNetworkId;
    readonly rpcUrl: string;
  }) => Promise<WalletPreferences>;
  readonly setStrk20ProverUrl: (input: { readonly url: string }) => Promise<WalletPreferences>;
  readonly setTokenHidden: (input: {
    readonly hidden: boolean;
    readonly tokenId: string;
  }) => Promise<WalletPreferences>;
  readonly upsertToken: (token: Omit<TokenConfig, "id">) => Promise<WalletPreferences>;
};

type WalletPreferencesStoreOptions = {
  readonly actor?: StoreActor;
  readonly store: KeyValueStore;
};

const PREFERENCE_KEYS: readonly string[] = [
  "accountLabels",
  "activeNetworkId",
  "addressBook",
  "customNetworks",
  "displayCurrency",
  "groups",
  "hiddenTokens",
  "nftIndexerUrl",
  "nfts",
  "rpcOverrides",
  "schemaVersion",
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
  (value["displayCurrency"] === undefined || isDisplayCurrency(value["displayCurrency"])) &&
  (value["groups"] === undefined || isAccountGroups(value["groups"])) &&
  (value["hiddenTokens"] === undefined || isHiddenTokens(value["hiddenTokens"])) &&
  (value["theme"] === undefined || isThemeChoice(value["theme"])) &&
  (value["rpcOverrides"] === undefined || isRpcOverrides(value["rpcOverrides"]));
const hasValidUrlAndNftFields = (value: Record<string, unknown>): boolean =>
  (value["strk20ProverUrl"] === undefined ||
    (typeof value["strk20ProverUrl"] === "string" && isCustomRpcUrl(value["strk20ProverUrl"]))) &&
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
  addressBook: [],
  customNetworks: [],
  displayCurrency: "usd",
  groups: [],
  hiddenTokens: [],
  nfts: [],
  rpcOverrides: {},
  schemaVersion: 1,
  theme: "dark",
  tokens: DEFAULT_TOKENS.map(withTokenId),
});

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
    // Self-heal legacy multi-group membership on read (the validator stays
    // permissive so old data loads rather than erroring): collapse each account
    // to a single folder so every consumer sees the single-group invariant.
    if (stored.groups === undefined) {
      return stored;
    }
    const groups = normalizeAccountGroups(stored.groups);
    return groups === stored.groups ? stored : { ...stored, groups };
  };

  return {
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
      const next = { ...preferences, groups: renameGroupPure(preferences.groups ?? [], id, name) };
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
      const next = { ...preferences, groups: setGroupIconPure(preferences.groups ?? [], id, icon) };
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
        (input.displayCurrency !== undefined && !isDisplayCurrency(input.displayCurrency)) ||
        (input.theme !== undefined && !isThemeChoice(input.theme))
      ) {
        throw new WalletError("Invalid display preference");
      }
      const preferences = await read();
      const next = {
        ...preferences,
        ...(input.displayCurrency === undefined ? {} : { displayCurrency: input.displayCurrency }),
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
    async setStrk20ProverUrl({ url }) {
      const trimmed = url.trim();
      if (trimmed.length > 0 && !isCustomRpcUrl(trimmed)) {
        throw new WalletError("Invalid prover endpoint");
      }
      const preferences = await read();
      const next = { ...preferences };
      if (trimmed.length === 0) {
        delete (next as { strk20ProverUrl?: string }).strk20ProverUrl;
      } else {
        (next as { strk20ProverUrl?: string }).strk20ProverUrl = trimmed;
      }
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
  };
};
