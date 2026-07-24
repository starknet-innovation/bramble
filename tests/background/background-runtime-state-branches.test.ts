/**
 * Branch coverage for the shared background status helpers: the network-switch
 * re-selection arm, the no-account-for-network context error, and the
 * readVault-throws fail-safe that locks the session and degrades status.
 */
import { describe, expect, test } from "bun:test";
import {
  activeAccountContext,
  statusResponse,
  switchActiveNetwork,
} from "../../src/background/runtime-state";
import type { WalletStatusReader } from "../../src/background/runtime-types";
import { createUnlockSession } from "../../src/background/session";
import { STARKNET_NETWORKS } from "../../src/starknet/networks";
import {
  defaultWalletPreferences,
  type WalletPreferences,
  type WalletPreferencesStore,
} from "../../src/storage/preferences-store";
import type { AccountRef, Vault } from "../../src/storage/vault-schema";
import type { WalletStatus as VaultStatus } from "../../src/wallet/vault-service";

const vaultPassphrase = "correct horse battery staple";

const sepoliaAccount: AccountRef = {
  address: "0xabcabcdef",
  classHash: "0xabcdef",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_SEPOLIA:0xabcabcdef",
  networkId: "SN_SEPOLIA",
  publicKeyX: "0xabc",
  publicKeyY: "0xdef",
};

const mainnetAccount: AccountRef = {
  ...sepoliaAccount,
  address: "0xabc111111",
  classHash: "0x111111",
  id: "SN_MAIN:0xabc111111",
  networkId: "SN_MAIN",
};

const vaultStatus: VaultStatus = {
  accountCount: 2,
  activeAccountId: sepoliaAccount.id,
  hasVault: true,
  locked: false,
  ready: true,
};

// A configurable wallet-reader stub; only the methods the status helpers touch
// carry behaviour, the rest reject so an unexpected call is loud.
const makeWallet = (overrides: Partial<WalletStatusReader>): WalletStatusReader => {
  const unexpected = () => {
    throw new Error("unexpected wallet call");
  };
  return {
    addDerivedAccount: unexpected,
    createAccount: unexpected,
    ensureNetworkAccount: unexpected,
    generateMnemonic: unexpected,
    getGrantedAccounts: unexpected,
    grantOrigin: unexpected,
    readVault: unexpected,
    setActiveAccount: unexpected,
    signHash: unexpected,
    async status() {
      return vaultStatus;
    },
    ...overrides,
  } as unknown as WalletStatusReader;
};

const makePreferencesStore = (
  preferences: WalletPreferences,
  onSetActiveNetwork?: (networkId: string) => void,
): WalletPreferencesStore =>
  ({
    async read() {
      return preferences;
    },
    async setActiveNetwork(networkId: string) {
      onSetActiveNetwork?.(networkId);
      return preferences;
    },
  }) as unknown as WalletPreferencesStore;

describe("switchActiveNetwork", () => {
  test("re-selects the network's first account when it differs from the active one", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const setActiveCalls: string[] = [];
    const switched: string[] = [];
    const wallet = makeWallet({
      async readVault() {
        return {
          accounts: [sepoliaAccount, mainnetAccount],
          activeAccountId: sepoliaAccount.id,
        } as unknown as Vault;
      },
      async setActiveAccount(input) {
        setActiveCalls.push(input.accountId);
        return mainnetAccount;
      },
    });
    const store = makePreferencesStore(defaultWalletPreferences(), (id) => {
      switched.push(id);
    });

    const selected = await switchActiveNetwork(wallet, session, store, "SN_MAIN");
    expect(selected).toEqual(mainnetAccount);
    expect(setActiveCalls).toEqual([mainnetAccount.id]);
    expect(switched).toEqual(["SN_MAIN"]);
  });

  test("returns null without touching the vault while the session is locked", async () => {
    const session = createUnlockSession();
    const switched: string[] = [];
    const wallet = makeWallet({});
    const store = makePreferencesStore(defaultWalletPreferences(), (id) => {
      switched.push(id);
    });

    const selected = await switchActiveNetwork(wallet, session, store, "SN_MAIN");
    expect(selected).toBeNull();
    expect(switched).toEqual(["SN_MAIN"]);
  });
});

describe("activeAccountContext", () => {
  test("errors when no account exists for the active network", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const wallet = makeWallet({
      async readVault() {
        return {
          accounts: [sepoliaAccount],
          activeAccountId: sepoliaAccount.id,
        } as unknown as Vault;
      },
    });
    // Active network is mainnet, but the vault only holds a Sepolia account.
    const store = makePreferencesStore({
      ...defaultWalletPreferences(),
      activeNetworkId: "SN_MAIN",
    });

    expect(await activeAccountContext(wallet, session, store)).toEqual({
      error: "no account for selected network",
    });
  });
});

describe("statusResponse", () => {
  test("locks the session and degrades status when the vault read throws", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    expect(session.isUnlocked()).toBe(true);
    const wallet = makeWallet({
      async readVault() {
        throw new Error("decrypt failed");
      },
    });
    const store = makePreferencesStore(defaultWalletPreferences());

    const status = await statusResponse(wallet, session, store);
    expect(session.isUnlocked()).toBe(false);
    expect(status.accounts).toEqual([]);
    expect(status.networkId).toBe(STARKNET_NETWORKS.SN_MAIN.id);
    expect(status.network).toBe(STARKNET_NETWORKS.SN_MAIN.name);
  });
});
