/**
 * A preferences store for contexts with no browser storage wired: reads return
 * defaults and every mutation throws. Split from ./runtime-state to keep each
 * file within the size budget; ./runtime-state re-exports it.
 */

import {
  defaultWalletPreferences,
  type WalletPreferencesStore,
} from "@bramble/settings/preferences";

/**
 * Fallback preferences store used by tests that do not wire browser storage.
 */
export const unavailablePreferencesStore: WalletPreferencesStore = {
  async addCustomNetwork() {
    throw new Error("preferences unavailable");
  },
  async addNft() {
    throw new Error("preferences unavailable");
  },
  async createGroup() {
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
  async removeGroup() {
    throw new Error("preferences unavailable");
  },
  async removeNft() {
    throw new Error("preferences unavailable");
  },
  async removeToken() {
    throw new Error("preferences unavailable");
  },
  async renameGroup() {
    throw new Error("preferences unavailable");
  },
  async setAccountInGroup() {
    throw new Error("preferences unavailable");
  },
  async setExplorerFallback() {
    throw new Error("preferences unavailable");
  },
  async setGroupIcon() {
    throw new Error("preferences unavailable");
  },
  async setAccountLabel() {
    throw new Error("preferences unavailable");
  },
  async setDisplay() {
    throw new Error("preferences unavailable");
  },
  async setNftIndexerUrl() {
    throw new Error("preferences unavailable");
  },
  async setNostrRelayUrl() {
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
  async setStrk20NetworkConfig() {
    throw new Error("preferences unavailable");
  },
  async setTokenHidden() {
    throw new Error("preferences unavailable");
  },
  async upsertToken() {
    throw new Error("preferences unavailable");
  },
};
