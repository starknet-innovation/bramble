/**
 * Plain wallet preferences kept outside the encrypted vault.
 */
import { WalletError } from "../shared/errors";
import { hasOnlyKnownKeys, isJson, isRecord } from "../shared/json";
import {
  DEFAULT_NETWORK,
  DEFAULT_TOKENS,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "../starknet/networks";
import { type CustomNetwork, isCustomNetwork, normalizeChainId } from "./custom-network";
import type { KeyValueStore } from "./kv";
import { isWatchedNft, type WatchedNft, withNftId } from "./nft";
import { assertStoreAccess, type StoreActor } from "./permissioned-store";
import { isAccountId } from "./vault-schema";

/**
 * Browser storage key for non-secret wallet preferences.
 */
export const PREFERENCES_STORE_KEY = "mc-wallet:preferences";

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
 * UI theme choice applied through the skin contract.
 */
export type ThemeChoice = "dark" | "light";

/**
 * Current plain preferences schema. `rpcOverrides` is optional so preferences
 * stored before it existed keep validating.
 */
export type WalletPreferences = {
  readonly accountLabels?: AccountLabels;
  readonly activeNetworkId: StarknetNetworkId;
  readonly addressBook: readonly AddressBookEntry[];
  readonly customNetworks?: readonly CustomNetwork[];
  readonly displayCurrency?: DisplayCurrency;
  readonly hiddenTokens?: readonly string[];
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
  readonly importPreferences: (candidate: unknown) => Promise<WalletPreferences>;
  readonly read: () => Promise<WalletPreferences>;
  readonly removeAddress: (id: string) => Promise<WalletPreferences>;
  readonly removeNft: (id: string) => Promise<WalletPreferences>;
  readonly saveAddress: (entry: Omit<AddressBookEntry, "id">) => Promise<WalletPreferences>;
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

const isSafeDecimals = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 36;

const isTokenSymbol = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z0-9]{2,12}$/.test(value);

const isLabel = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= 64;

const tokenId = (token: Omit<TokenConfig, "id">): string =>
  `${token.networkId}:${token.symbol}:${token.address}`;

const addressBookId = (entry: Omit<AddressBookEntry, "id">): string =>
  `${entry.networkId}:${entry.address}`;

const withTokenId = (token: Omit<TokenConfig, "id">): TokenConfig => ({
  ...token,
  id: tokenId(token),
});

const withAddressBookId = (entry: Omit<AddressBookEntry, "id">): AddressBookEntry => ({
  ...entry,
  id: addressBookId(entry),
});

const isTokenConfig = (value: unknown): value is TokenConfig =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["address", "decimals", "id", "name", "networkId", "symbol"]) &&
  typeof value.address === "string" &&
  isNonZeroStarkFieldElement(value.address) &&
  isSafeDecimals(value.decimals) &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  value.name.trim().length > 0 &&
  value.name.trim().length <= 64 &&
  isStarknetNetworkId(value.networkId) &&
  isTokenSymbol(value.symbol) &&
  value.id === `${value.networkId}:${value.symbol}:${value.address}`;

const isAddressBookEntry = (value: unknown): value is AddressBookEntry =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["address", "id", "label", "networkId"]) &&
  typeof value.address === "string" &&
  isNonZeroStarkFieldElement(value.address) &&
  typeof value.id === "string" &&
  isLabel(value.label) &&
  isStarknetNetworkId(value.networkId) &&
  value.id === `${value.networkId}:${value.address}`;

const hasUniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const isLoopbackHost = (host: string): boolean => host === "localhost" || host === "127.0.0.1";

/**
 * Checks a user-provided RPC endpoint: https anywhere, http only on loopback.
 */
export const isCustomRpcUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
  } catch {
    return false;
  }
};

const isAccountLabels = (value: unknown): value is AccountLabels =>
  isRecord(value) &&
  Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && isAccountId(key) && isLabel(value[key]),
  );

const isDisplayCurrency = (value: unknown): value is DisplayCurrency =>
  value === "eur" || value === "gbp" || value === "usd";

const isThemeChoice = (value: unknown): value is ThemeChoice =>
  value === "dark" || value === "light";

const isTokenId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;

const isHiddenTokens = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isTokenId) && hasUniqueStrings(value);

const isRpcOverrides = (value: unknown): value is RpcOverrides =>
  isRecord(value) &&
  Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && isStarknetNetworkId(key) && isCustomRpcUrl(value[key]),
  );

/**
 * Checks stored plain preferences before use.
 */
export const isWalletPreferences = (value: unknown): value is WalletPreferences =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, [
    "accountLabels",
    "activeNetworkId",
    "addressBook",
    "customNetworks",
    "displayCurrency",
    "hiddenTokens",
    "nfts",
    "rpcOverrides",
    "schemaVersion",
    "strk20ProverUrl",
    "theme",
    "tokens",
  ]) &&
  (value.customNetworks === undefined ||
    (Array.isArray(value.customNetworks) &&
      value.customNetworks.every(isCustomNetwork) &&
      hasUniqueStrings(
        value.customNetworks.map((network) => normalizeChainId(network.chainId)),
      ))) &&
  (value.accountLabels === undefined || isAccountLabels(value.accountLabels)) &&
  (value.displayCurrency === undefined || isDisplayCurrency(value.displayCurrency)) &&
  (value.hiddenTokens === undefined || isHiddenTokens(value.hiddenTokens)) &&
  (value.theme === undefined || isThemeChoice(value.theme)) &&
  (value.rpcOverrides === undefined || isRpcOverrides(value.rpcOverrides)) &&
  (value.strk20ProverUrl === undefined ||
    (typeof value.strk20ProverUrl === "string" && isCustomRpcUrl(value.strk20ProverUrl))) &&
  (value.nfts === undefined ||
    (Array.isArray(value.nfts) &&
      value.nfts.every(isWatchedNft) &&
      hasUniqueStrings(value.nfts.map((nft) => nft.id)))) &&
  value.schemaVersion === 1 &&
  isStarknetNetworkId(value.activeNetworkId) &&
  Array.isArray(value.addressBook) &&
  value.addressBook.every(isAddressBookEntry) &&
  hasUniqueStrings(value.addressBook.map((entry) => entry.id)) &&
  Array.isArray(value.tokens) &&
  value.tokens.every(isTokenConfig) &&
  hasUniqueStrings(value.tokens.map((token) => token.id));

/**
 * Creates default non-secret wallet preferences.
 */
export const defaultWalletPreferences = (): WalletPreferences => ({
  accountLabels: {},
  activeNetworkId: DEFAULT_NETWORK.id,
  addressBook: [],
  customNetworks: [],
  displayCurrency: "usd",
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
    return stored;
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
