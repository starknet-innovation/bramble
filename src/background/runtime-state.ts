/**
 * Shared background status helpers for wallet runtime messages.
 */
import {
  DEFAULT_NETWORK,
  STARKNET_NETWORKS,
  type StarknetNetwork,
  type StarknetNetworkId,
} from "../starknet/networks";
import {
  defaultWalletPreferences,
  type WalletPreferences,
  type WalletPreferencesStore,
} from "../storage/preferences-store";
import type { AccountRef, Vault } from "../storage/vault-schema";
import type { NetworkOption, WalletStatus, WalletStatusReader } from "./runtime-types";
import type { UnlockSession } from "./session";

const networkOptions = (): readonly NetworkOption[] =>
  Object.values(STARKNET_NETWORKS).map((network) => ({
    id: network.id,
    name: network.name,
  }));

/**
 * Fallback preferences store used by tests that do not wire browser storage.
 */
export const unavailablePreferencesStore: WalletPreferencesStore = {
  async addNft() {
    throw new Error("preferences unavailable");
  },
  async importPreferences() {
    throw new Error("preferences unavailable");
  },
  async read() {
    return defaultWalletPreferences();
  },
  async removeAddress() {
    throw new Error("preferences unavailable");
  },
  async removeNft() {
    throw new Error("preferences unavailable");
  },
  async setAccountLabel() {
    throw new Error("preferences unavailable");
  },
  async setDisplay() {
    throw new Error("preferences unavailable");
  },
  async setNftSpam() {
    throw new Error("preferences unavailable");
  },
  async saveAddress() {
    throw new Error("preferences unavailable");
  },
  async setActiveNetwork(networkId) {
    return { ...defaultWalletPreferences(), activeNetworkId: networkId };
  },
  async setRpcOverride() {
    throw new Error("preferences unavailable");
  },
  async upsertToken() {
    throw new Error("preferences unavailable");
  },
};

/**
 * Ordered RPC endpoints for a network, preferring the user's custom override
 * as the default and keeping built-in endpoints as fallback.
 */
export const networkRpcUrls = (
  network: StarknetNetwork,
  preferences: WalletPreferences,
): readonly string[] => {
  const override = preferences.rpcOverrides?.[network.id];
  return override ? [override, ...network.rpcUrls] : network.rpcUrls;
};

/**
 * Returns the active account for a network, falling back to the first account on that network.
 */
export const accountForNetwork = (
  vault: Vault,
  networkId: StarknetNetworkId,
  accountId?: string | null,
): AccountRef | null =>
  vault.accounts.find((account) => account.id === accountId && account.networkId === networkId) ??
  vault.accounts.find((account) => account.networkId === networkId) ??
  null;

/**
 * Switches the active network and selects or derives the matching wallet account.
 */
export const switchActiveNetwork = async (
  wallet: WalletStatusReader,
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
  networkId: StarknetNetworkId,
): Promise<AccountRef | null> => {
  const passphrase = session.getPassphrase();
  let selected: AccountRef | null = null;
  if (passphrase) {
    const vault = await wallet.readVault(passphrase);
    const account = accountForNetwork(vault, networkId, vault.activeAccountId);
    if (account && account.id !== vault.activeAccountId) {
      selected = await wallet.setActiveAccount({
        accountId: account.id,
        vaultPassphrase: passphrase,
      });
    } else if (account) {
      selected = account;
    } else if (vault.accounts.length > 0) {
      selected = await wallet.ensureNetworkAccount({ networkId, vaultPassphrase: passphrase });
    }
  }
  await preferencesStore.setActiveNetwork(networkId);
  return selected;
};

/**
 * Resolves the active network account behind an unlocked session, or the
 * error response to return when it cannot be resolved.
 */
export const activeAccountContext = async (
  wallet: WalletStatusReader,
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
): Promise<
  | { readonly error: string }
  | {
      readonly account: AccountRef;
      readonly error?: never;
      readonly networkId: StarknetNetworkId;
      readonly vaultPassphrase: string;
    }
> => {
  const vaultPassphrase = session.getPassphrase();
  if (!vaultPassphrase) {
    return { error: "wallet locked" };
  }
  const preferences = await preferencesStore.read();
  const vault = await wallet.readVault(vaultPassphrase);
  const account = accountForNetwork(vault, preferences.activeNetworkId, vault.activeAccountId);
  if (!account) {
    return { error: "no account for selected network" };
  }
  return { account, networkId: preferences.activeNetworkId, vaultPassphrase };
};

/**
 * Builds extension-page wallet status from vault and preferences state.
 */
export const statusResponse = async (
  wallet: WalletStatusReader,
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
): Promise<WalletStatus> => {
  const status = await wallet.status();
  const preferences = await preferencesStore.read();
  const network = STARKNET_NETWORKS[preferences.activeNetworkId];
  const passphrase = session.getPassphrase();
  if (!passphrase) {
    return {
      ...status,
      accounts: [],
      network: network.name,
      networkId: network.id,
      networks: networkOptions(),
    };
  }

  try {
    const vault = await wallet.readVault(passphrase);
    return {
      ...status,
      accountCount: vault.accounts.length,
      activeAccountId: vault.activeAccountId,
      accounts: vault.accounts,
      locked: false,
      network: network.name,
      networkId: network.id,
      networks: networkOptions(),
    };
  } catch {
    session.lock();
    return {
      ...status,
      accounts: [],
      network: DEFAULT_NETWORK.name,
      networkId: DEFAULT_NETWORK.id,
      networks: networkOptions(),
    };
  }
};
