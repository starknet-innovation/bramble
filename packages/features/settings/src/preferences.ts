/** Plain wallet preferences kept outside the encrypted vault. */
import { WalletError } from "@bramble/core/errors";
import { isJson } from "@bramble/core/json";
import { isWatchedNft, withNftId } from "@bramble/portfolio/watched-nft";
import {
  DEFAULT_STRK20_NETWORKS,
  isStrk20NetworkConfig,
  STRK20_MAINNET_POOL,
  type Strk20NetworkConfig,
} from "@bramble/privacy/config";
import { assertStoreAccess, type StoreActor } from "@bramble/store/access";
import type { KeyValueStore } from "@bramble/store/kv";
import { serializeStoreMutations } from "@bramble/store/mutation";
import { isAccountId } from "@bramble/wallet-model/accounts";
import {
  isCustomNetwork,
  isCustomRpcUrl,
  normalizeChainId,
} from "@bramble/wallet-model/custom-network";
import {
  DEFAULT_NETWORK,
  DEFAULT_TOKENS,
  isStarknetNetworkId,
  STRK_TOKEN_ADDRESS,
} from "@bramble/wallet-model/networks";

import {
  isAddressBookEntry,
  isApprovalSurfacePreference,
  isDisplayCurrency,
  isLabel,
  isThemeChoice,
  isTokenConfig,
  isTokenId,
  withAddressBookId,
  withTokenId,
} from "@bramble/wallet-model/preferences";
import {
  createGroup as createGroupPure,
  normalizeAccountGroups,
  removeGroup as removeGroupPure,
  renameGroup as renameGroupPure,
  setAccountInGroup as setAccountInGroupPure,
  setGroupIcon as setGroupIconPure,
} from "./groups";
import { withExplorerSettings } from "./preferences-explorer";
import { withNostrRelayUrl } from "./preferences-nostr";
import {
  isWalletPreferences,
  normalizeStoredPreferences,
  pickImportablePreferences,
} from "./preferences-stored";
import type { WalletPreferences, WalletPreferencesStore } from "./preferences-types";

/** Re-exported entry types so callers keep importing them from this store. */
export type {
  AccountLabels,
  AddressBookEntry,
  ApprovalSurfacePreference,
  DisplayCurrency,
  ExplorerApiOverrides,
  ExplorerFallback,
  ExplorerLanePreferences,
  RpcOverrides,
  ThemeChoice,
  TokenConfig,
} from "@bramble/wallet-model/preferences";
/** Explorer-lane resolver colocated with the preferences it reads. */
export { explorerFallbackAllowed } from "@bramble/wallet-model/preferences";
/** Re-exported store schema and capability types. */
export type {
  WalletPreferences,
  WalletPreferencesStore,
} from "./preferences-types";

/**
 * Browser storage key for non-secret wallet preferences.
 */
export const PREFERENCES_STORE_KEY = "bramble:preferences";

type WalletPreferencesStoreOptions = {
  readonly actor?: StoreActor;
  readonly store: KeyValueStore;
};

/**
 * Stored-shape guard, re-exported so existing importers keep one entry point
 * for the store and the record it validates.
 */
export { isWalletPreferences } from "./preferences-stored";

const isValidDisplayInput = (
  input: Parameters<WalletPreferencesStore["setDisplay"]>[0],
): boolean => {
  if (input.approvalSurface !== undefined && !isApprovalSurfacePreference(input.approvalSurface)) {
    return false;
  }
  if (input.displayCurrency !== undefined && !isDisplayCurrency(input.displayCurrency)) {
    return false;
  }
  if (input.productAnalytics !== undefined && typeof input.productAnalytics !== "boolean") {
    return false;
  }
  if (
    input.reliabilityDiagnostics !== undefined &&
    typeof input.reliabilityDiagnostics !== "boolean"
  ) {
    return false;
  }
  return input.theme === undefined || isThemeChoice(input.theme);
};

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
  explorerFallback: {},
  explorerApiUrls: {},
  groups: [],
  hiddenTokens: [],
  nfts: [],
  productAnalytics: true,
  reliabilityDiagnostics: false,
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

const withCurrentDefaults = (preferences: WalletPreferences): WalletPreferences => {
  const current = { ...preferences, productAnalytics: preferences.productAnalytics ?? true };
  if (current.strk20Networks === undefined) {
    return { ...current, strk20Networks: DEFAULT_STRK20_NETWORKS };
  }
  if (!isRetiredBundledMainnetRouting(current.strk20Networks.SN_MAIN)) {
    return current;
  }
  return {
    ...current,
    strk20Networks: { ...current.strk20Networks, ...DEFAULT_STRK20_NETWORKS },
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
    // Normalized before it is validated, never after: a record an earlier build
    // wrote with a second spelling of one address is repaired here rather than
    // failing the strict entry guards and locking the user out of preferences.
    const stored = normalizeStoredPreferences(await store.get(PREFERENCES_STORE_KEY));
    if (stored === undefined) {
      return defaultWalletPreferences();
    }
    if (!isWalletPreferences(stored)) {
      throw new WalletError("Invalid stored preferences");
    }
    const current = withCurrentDefaults(stored);
    // Self-heal legacy multi-group membership on read (the validator stays
    // permissive so old data loads rather than erroring): collapse each account
    // to a single folder so every consumer sees the single-group invariant.
    if (current.groups === undefined) {
      return current;
    }
    const groups = normalizeAccountGroups(current.groups);
    return groups === current.groups ? current : { ...current, groups };
  };

  // Merge base for a restore, the recovery path out of a record this build
  // cannot read (future key, schema bump, corrupt blob): an unreadable record
  // falls back to defaults rather than propagating. `get` faults still surface.
  const readImportBase = async (): Promise<WalletPreferences> =>
    isWalletPreferences(normalizeStoredPreferences(await store.get(PREFERENCES_STORE_KEY)))
      ? await read()
      : defaultWalletPreferences();

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
        // A backup written by an older build carries the old entry spelling, so
        // it is normalized before validation exactly like a stored record.
        const backup = normalizeStoredPreferences(candidate);
        if (!isWalletPreferences(backup)) {
          throw new WalletError("Invalid preferences backup");
        }
        // A backup file is untrusted input, so a restore may only reapply the
        // organisational fields; every trust-bearing setting the review layer
        // reads — including the contacts the address-poisoning guard compares
        // against — keeps its stored value (see `pickImportablePreferences`).
        const next = { ...(await readImportBase()), ...pickImportablePreferences(backup) };
        await writePreferences(store, next);
        return next;
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
      async setExplorerFallback(input) {
        const next = withExplorerSettings(await read(), input);
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
        if (!isValidDisplayInput(input)) {
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
          ...(input.productAnalytics === undefined
            ? {}
            : { productAnalytics: input.productAnalytics }),
          ...(input.reliabilityDiagnostics === undefined
            ? {}
            : { reliabilityDiagnostics: input.reliabilityDiagnostics }),
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
        const previous = preferences.addressBook.find((stored) => stored.id === nextEntry.id);
        const savedEntry = {
          ...nextEntry,
          ...(nextEntry.nostrPublicKey || !previous?.nostrPublicKey
            ? {}
            : { nostrPublicKey: previous.nostrPublicKey }),
          ...(nextEntry.publicKeyX || !previous?.publicKeyX
            ? {}
            : { publicKeyX: previous.publicKeyX }),
        };
        const entries = preferences.addressBook.filter((stored) => stored.id !== nextEntry.id);
        const next = { ...preferences, addressBook: [...entries, savedEntry] };
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
      async setNostrRelayUrl({ relayUrl }) {
        const next = withNostrRelayUrl(await read(), relayUrl);
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
