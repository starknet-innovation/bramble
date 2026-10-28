/** Fail-closed cross-store account-selection invariants. */
import { describe, expect, test } from "bun:test";
import {
  defaultWalletPreferences,
  type WalletPreferencesStore,
} from "@bramble/settings/preferences";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { WalletStatusReader } from "../../../apps/extension/src/background/accounts/wallet-reader";
import {
  runGuardedNetworkMutation,
  runUnlockedNetworkMutation,
  runVaultCreationWithNetwork,
} from "../../../apps/extension/src/background/runtime/active-network-mutation";
import { selectActiveAccount } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";

const vaultPassphrase = "correct horse battery staple";
const mainnetAccount: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0xabc",
  classHash: "0xdef",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0xabc",
  networkId: "SN_MAIN",
  publicKeyX: "0x1",
  publicKeyY: "0x2",
};
const sepoliaAccount: AccountRef = {
  ...mainnetAccount,
  address: "0x123",
  id: "SN_SEPOLIA:0x123",
  networkId: "SN_SEPOLIA",
};

const wallet = (setActiveAccount: WalletStatusReader["setActiveAccount"]): WalletStatusReader =>
  ({
    async readVault() {
      return {
        accounts: [sepoliaAccount, mainnetAccount],
        activeAccountId: sepoliaAccount.id,
      } as unknown as Vault;
    },
    setActiveAccount,
  }) as unknown as WalletStatusReader;

describe("active account selection", () => {
  test("locks when a network-intent write may have partially failed", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    let selections = 0;
    let activeNetworkId = sepoliaAccount.networkId;
    const preferencesStore = {
      // The guard reads the active network first, to undo it on a refusal
      // the vault raises before writing.
      async read() {
        return defaultWalletPreferences();
      },
      async setActiveNetwork(networkId: typeof activeNetworkId) {
        activeNetworkId = networkId;
        throw new Error("injected preference failure");
      },
    } as unknown as WalletPreferencesStore;

    await expect(
      selectActiveAccount(
        wallet(async () => {
          selections += 1;
          return mainnetAccount;
        }),
        session,
        preferencesStore,
        mainnetAccount.id,
      ),
    ).rejects.toThrow("injected preference failure");
    expect(selections).toBe(0);
    expect(activeNetworkId).toBe("SN_MAIN");
    expect(session.isUnlocked()).toBe(false);
  });

  test("applies the same fail-closed rule to account creation mutations", async () => {
    for (const mutation of ["add", "create"] as const) {
      const session = createUnlockSession();
      session.unlock(vaultPassphrase);
      const preferencesStore = {
        async read() {
          return defaultWalletPreferences();
        },
        async setActiveNetwork() {
          return defaultWalletPreferences();
        },
      } as unknown as WalletPreferencesStore;
      const fail = async (): Promise<AccountRef> => {
        throw new Error(`injected ${mutation} failure`);
      };

      const result =
        mutation === "add"
          ? runUnlockedNetworkMutation(session, preferencesStore, "SN_MAIN", async () => fail())
          : runVaultCreationWithNetwork(session, preferencesStore, "SN_MAIN", fail);
      await expect(result).rejects.toThrow(`injected ${mutation} failure`);
      expect(session.isUnlocked()).toBe(false);
    }
  });

  test("locks when the vault pointer cannot commit after network intent", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    let activeNetworkId = sepoliaAccount.networkId;
    const preferencesStore = {
      async read() {
        return defaultWalletPreferences();
      },
      async setActiveNetwork(networkId: typeof activeNetworkId) {
        activeNetworkId = networkId;
        return defaultWalletPreferences();
      },
    } as unknown as WalletPreferencesStore;

    await expect(
      selectActiveAccount(
        wallet(async () => {
          throw new Error("injected vault failure");
        }),
        session,
        preferencesStore,
        mainnetAccount.id,
      ),
    ).rejects.toThrow("injected vault failure");
    expect(activeNetworkId).toBe("SN_MAIN");
    expect(session.isUnlocked()).toBe(false);
  });

  test("never locks a replacement session after stale work resumes", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const writeStarted = Promise.withResolvers<void>();
    const releaseWrite = Promise.withResolvers<void>();
    let selections = 0;
    const preferencesStore = {
      async read() {
        return defaultWalletPreferences();
      },
      async setActiveNetwork() {
        writeStarted.resolve();
        await releaseWrite.promise;
        return defaultWalletPreferences();
      },
    } as unknown as WalletPreferencesStore;
    const selecting = selectActiveAccount(
      wallet(async () => {
        selections += 1;
        return mainnetAccount;
      }),
      session,
      preferencesStore,
      mainnetAccount.id,
    );

    await writeStarted.promise;
    session.lock();
    session.unlock("replacement horse battery staple");
    releaseWrite.resolve();

    await expect(selecting).rejects.toThrow("Unlock session changed during account selection");
    expect(selections).toBe(0);
    expect(session.peekPassphrase()).toBe("replacement horse battery staple");
  });

  test("a stale helper caller cannot begin its first preference write", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const generation = session.generation();
    session.unlock("replacement horse battery staple");
    let preferenceWrites = 0;
    const preferencesStore = {
      async read() {
        return defaultWalletPreferences();
      },
      async setActiveNetwork() {
        preferenceWrites += 1;
        return defaultWalletPreferences();
      },
    } as unknown as WalletPreferencesStore;

    await expect(
      runGuardedNetworkMutation(
        session,
        preferencesStore,
        "SN_MAIN",
        vaultPassphrase,
        generation,
        "stale selection",
        async () => mainnetAccount,
      ),
    ).rejects.toThrow("stale selection");
    expect(preferenceWrites).toBe(0);
    expect(session.peekPassphrase()).toBe("replacement horse battery staple");
  });
});
