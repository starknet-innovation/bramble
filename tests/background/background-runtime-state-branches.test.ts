/**
 * Branch coverage for the shared background status helpers: the network-switch
 * re-selection arm, the no-account-for-network context error, and the
 * readVault-throws fail-safe that locks the session and degrades status.
 */
import { describe, expect, test } from "bun:test";
import {
  defaultWalletPreferences,
  type WalletPreferences,
  type WalletPreferencesStore,
} from "@mc-wallet/settings/preferences";
import type { Vault } from "@mc-wallet/vault/schema";
import type { WalletStatus as VaultStatus } from "@mc-wallet/vault/service";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import {
  activeAccountContext,
  createActiveStateCoordinator,
  reconcileActiveAccount,
  reconcileUnlockedActiveAccount,
  statusResponse,
  switchActiveNetwork,
} from "../../apps/extension/src/background/runtime-state";
import { createUnlockSession } from "../../apps/extension/src/background/session";
import type { WalletStatusReader } from "../../apps/extension/src/background/wallet-reader";

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

  test("locks when a network-intent write commits and then rejects", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    let vaultReads = 0;
    const durable: { networkId: WalletPreferences["activeNetworkId"] } = {
      networkId: "SN_SEPOLIA",
    };
    const wallet = makeWallet({
      async readVault() {
        vaultReads += 1;
        throw new Error("vault should not be read");
      },
    });
    const store = {
      ...makePreferencesStore(defaultWalletPreferences()),
      async setActiveNetwork(networkId: WalletPreferences["activeNetworkId"]) {
        durable.networkId = networkId;
        throw new Error("injected preference write failure");
      },
    };

    await expect(switchActiveNetwork(wallet, session, store, "SN_MAIN")).rejects.toThrow(
      "injected preference write failure",
    );
    expect(vaultReads).toBe(0);
    expect(durable.networkId).toBe("SN_MAIN");
    expect(session.isUnlocked()).toBe(false);
  });

  test("locks the authorizing session when a vault-side network switch fails", async () => {
    for (const failingStep of ["read", "select", "derive"] as const) {
      const session = createUnlockSession();
      session.unlock(vaultPassphrase);
      const wallet = makeWallet({
        async ensureNetworkAccount() {
          if (failingStep === "derive") throw new Error("injected derive failure");
          return mainnetAccount;
        },
        async readVault() {
          if (failingStep === "read") throw new Error("injected read failure");
          return {
            accounts:
              failingStep === "derive" ? [sepoliaAccount] : [sepoliaAccount, mainnetAccount],
            activeAccountId: sepoliaAccount.id,
          } as unknown as Vault;
        },
        async setActiveAccount() {
          if (failingStep === "select") throw new Error("injected select failure");
          return mainnetAccount;
        },
      });

      await expect(
        switchActiveNetwork(
          wallet,
          session,
          makePreferencesStore(defaultWalletPreferences()),
          "SN_MAIN",
        ),
      ).rejects.toThrow(`injected ${failingStep} failure`);
      expect(session.isUnlocked()).toBe(false);
    }
  });

  test("never revokes a replacement unlock or mutates after the old session changes", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const readStarted = Promise.withResolvers<void>();
    const releaseRead = Promise.withResolvers<void>();
    let selections = 0;
    const wallet = makeWallet({
      async readVault() {
        readStarted.resolve();
        await releaseRead.promise;
        return {
          accounts: [sepoliaAccount, mainnetAccount],
          activeAccountId: sepoliaAccount.id,
        } as unknown as Vault;
      },
      async setActiveAccount() {
        selections += 1;
        return mainnetAccount;
      },
    });
    const switching = switchActiveNetwork(
      wallet,
      session,
      makePreferencesStore(defaultWalletPreferences()),
      "SN_MAIN",
    );
    await readStarted.promise;
    session.lock();
    session.unlock(vaultPassphrase);
    releaseRead.resolve();

    await expect(switching).rejects.toThrow("Unlock session changed during network switch");
    expect(selections).toBe(0);
    expect(session.isUnlocked()).toBe(true);
  });

  test("serializes concurrent selections so the last network intent wins", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const firstReadStarted = Promise.withResolvers<void>();
    const releaseFirstRead = Promise.withResolvers<void>();
    let readCount = 0;
    let activeAccountId = sepoliaAccount.id;
    let preferences: WalletPreferences = {
      ...defaultWalletPreferences(),
      activeNetworkId: "SN_SEPOLIA",
    };
    const wallet = makeWallet({
      async readVault() {
        readCount += 1;
        if (readCount === 1) {
          firstReadStarted.resolve();
          await releaseFirstRead.promise;
        }
        return {
          accounts: [sepoliaAccount, mainnetAccount],
          activeAccountId,
        } as unknown as Vault;
      },
      async setActiveAccount(input) {
        activeAccountId = input.accountId;
        return input.accountId === mainnetAccount.id ? mainnetAccount : sepoliaAccount;
      },
    });
    const store = {
      ...makePreferencesStore(preferences),
      async read() {
        return preferences;
      },
      async setActiveNetwork(networkId: WalletPreferences["activeNetworkId"]) {
        preferences = { ...preferences, activeNetworkId: networkId };
        return preferences;
      },
    };
    const coordinator = createActiveStateCoordinator();

    const first = switchActiveNetwork(wallet, session, store, "SN_MAIN", coordinator);
    await firstReadStarted.promise;
    const second = switchActiveNetwork(wallet, session, store, "SN_SEPOLIA", coordinator);
    await Promise.resolve();
    expect(readCount).toBe(1);
    releaseFirstRead.resolve();
    await Promise.all([first, second]);

    expect(preferences.activeNetworkId).toBe("SN_SEPOLIA");
    expect(activeAccountId).toBe(sepoliaAccount.id);
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

describe("reconcileActiveAccount", () => {
  test("durably selects the account belonging to the stored network", async () => {
    const selected: string[] = [];
    const wallet = makeWallet({
      async readVault() {
        return {
          accounts: [sepoliaAccount, mainnetAccount],
          activeAccountId: sepoliaAccount.id,
        } as unknown as Vault;
      },
      async setActiveAccount(input) {
        selected.push(input.accountId);
        return mainnetAccount;
      },
    });
    const store = makePreferencesStore({
      ...defaultWalletPreferences(),
      activeNetworkId: "SN_MAIN",
    });

    await expect(reconcileActiveAccount(wallet, store, vaultPassphrase)).resolves.toEqual(
      mainnetAccount,
    );
    expect(selected).toEqual([mainnetAccount.id]);
  });

  test("repairs an unlocked session without renewing it", async () => {
    let now = 0;
    const session = createUnlockSession(100, () => now);
    session.unlock(vaultPassphrase);
    const selected: string[] = [];
    const wallet = makeWallet({
      async readVault() {
        return {
          accounts: [sepoliaAccount, mainnetAccount],
          activeAccountId: sepoliaAccount.id,
        } as unknown as Vault;
      },
      async setActiveAccount(input) {
        selected.push(input.accountId);
        return mainnetAccount;
      },
    });
    const store = makePreferencesStore({
      ...defaultWalletPreferences(),
      activeNetworkId: "SN_MAIN",
    });

    now = 90;
    await expect(reconcileUnlockedActiveAccount(wallet, session, store)).resolves.toEqual(
      mainnetAccount,
    );
    expect(selected).toEqual([mainnetAccount.id]);
    now = 101;
    expect(session.isUnlocked()).toBe(false);
  });

  test("locks the authorizing session when reconciliation fails", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const wallet = makeWallet({
      async readVault() {
        throw new Error("injected vault read failure");
      },
    });

    await expect(
      reconcileUnlockedActiveAccount(
        wallet,
        session,
        makePreferencesStore(defaultWalletPreferences()),
      ),
    ).resolves.toBeNull();
    expect(session.isUnlocked()).toBe(false);
  });

  test("does not mutate or lock a replacement unlock session", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const selected: string[] = [];
    const wallet = makeWallet({
      async readVault() {
        session.unlock("replacement horse battery staple");
        return {
          accounts: [sepoliaAccount, mainnetAccount],
          activeAccountId: sepoliaAccount.id,
        } as unknown as Vault;
      },
      async setActiveAccount(input) {
        selected.push(input.accountId);
        return mainnetAccount;
      },
    });
    const store = makePreferencesStore({
      ...defaultWalletPreferences(),
      activeNetworkId: "SN_MAIN",
    });

    await expect(reconcileUnlockedActiveAccount(wallet, session, store)).resolves.toBeNull();
    expect(selected).toEqual([]);
    expect(session.peekPassphrase()).toBe("replacement horse battery staple");
  });
});

describe("statusResponse", () => {
  test("projects the selected network account when durable stores briefly disagree", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const wallet = makeWallet({
      async readVault() {
        return {
          accounts: [sepoliaAccount, mainnetAccount],
          activeAccountId: sepoliaAccount.id,
        } as unknown as Vault;
      },
    });
    const store = makePreferencesStore({
      ...defaultWalletPreferences(),
      activeNetworkId: "SN_MAIN",
    });

    const status = await statusResponse(wallet, session, store);
    expect(status.activeAccountId).toBe(mainnetAccount.id);
    expect(status.networkId).toBe("SN_MAIN");
  });

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
