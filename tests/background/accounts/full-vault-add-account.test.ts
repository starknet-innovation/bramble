/**
 * Adding an account to a full vault (Sherlock 261).
 *
 * Add-account runs inside the guard that locks the session on any failure,
 * because a storage failure leaves the outcome ambiguous. A full vault is
 * refused before anything is written, so it must not sign the user out or
 * leave the requested network active: it answers the full-wallet error and
 * the wallet stays as it was. Every other failure still locks.
 */
import { describe, expect, test } from "bun:test";
import { RefusedBeforeWrite, WalletError } from "@bramble/core/errors";
import { isJson } from "@bramble/core/json";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { emptyVault, type Vault } from "@bramble/vault/schema";
import { createWalletVaultService } from "@bramble/vault/service";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { runUnlockedNetworkMutation } from "../../../apps/extension/src/background/runtime/active-network-mutation";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";

const vaultPassphrase = "correct horse battery staple";
const VAULT_FULL = "Vault storage limit reached";
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

// Full-width felts, as real addresses and keys are.
const felt = (index: number, salt: bigint): string =>
  `0x7${((BigInt(index) + 1n) * 0x9e3779b97f4a7c15n * salt).toString(16).padStart(62, "0").slice(-62)}`;

const vaultWith = (count: number): Vault => {
  const accounts = Array.from({ length: count }, (_, index) => ({
    accountContractType: "openzeppelin" as const,
    address: felt(index, 3n),
    classHash: "0x61dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f",
    derivation: { accountIndex: index, addressIndex: 0, kind: "starknet-bip44" as const },
    id: `SN_MAIN:${felt(index, 3n)}`,
    networkId: "SN_MAIN" as const,
    publicKeyX: felt(index, 5n),
    publicKeyY: felt(index, 7n),
  }));
  return {
    ...emptyVault(),
    accounts,
    activeAccountId: accounts[0]?.id ?? null,
    mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
    signingKeys: accounts.map((account, index) => ({
      accountId: account.id,
      privateKey: felt(index, 11n),
    })),
  };
};

// The largest vault the validators accept: one more account does not fit.
const fullVault = (): Vault => {
  let low = 1;
  let high = 2_000;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (isJson(vaultWith(middle))) low = middle;
    else high = middle - 1;
  }
  return vaultWith(low);
};

const preferencesOn = async (store: KeyValueStore) => {
  const preferencesStore = createPreferencesStore({ store });
  await preferencesStore.setActiveNetwork("SN_MAIN");
  return preferencesStore;
};

describe("a full vault", () => {
  test("refuses add-account without signing out or switching network", async () => {
    const local = createMemoryStore();
    const encryptedStore = createEncryptedStore(local, "bramble:vault");
    await encryptedStore.write(fullVault(), vaultPassphrase);
    const before = await encryptedStore.read(vaultPassphrase);
    const wallet = createWalletVaultService({
      encryptedStore,
      kms: fakeKms(),
      migrationStore: createEncryptedStore(local, "bramble:vault-migration"),
    });
    const preferencesStore = await preferencesOn(createMemoryStore());
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(wallet, testExtension, { preferencesStore, session });

    await expect(
      handler(
        { accountContractType: "openzeppelin", networkId: "SN_SEPOLIA", type: "wallet.addAccount" },
        sender,
      ),
    ).resolves.toEqual({ error: VAULT_FULL });

    expect(session.peekPassphrase()).toBe(vaultPassphrase);
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_MAIN");
    expect(await encryptedStore.read(vaultPassphrase)).toEqual(before);
  });
});

describe("the network mutation guard", () => {
  test("keeps the session and restores the network on a refusal before write", async () => {
    const preferencesStore = await preferencesOn(createMemoryStore());
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);

    await expect(
      runUnlockedNetworkMutation(session, preferencesStore, "SN_SEPOLIA", async () => {
        throw new RefusedBeforeWrite(VAULT_FULL);
      }),
    ).rejects.toThrow(VAULT_FULL);

    expect(session.peekPassphrase()).toBe(vaultPassphrase);
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_MAIN");
  });

  test("still locks on any other failure", async () => {
    const preferencesStore = await preferencesOn(createMemoryStore());
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);

    await expect(
      runUnlockedNetworkMutation(session, preferencesStore, "SN_SEPOLIA", async () => {
        throw new WalletError("storage write failed");
      }),
    ).rejects.toThrow("storage write failed");

    expect(session.peekPassphrase()).toBeNull();
  });

  test("locks when undoing the network write fails", async () => {
    const store = createMemoryStore();
    const preferencesStore = await preferencesOn(store);
    let writes = 0;
    const failingUndo = {
      ...preferencesStore,
      async setActiveNetwork(networkId: Parameters<typeof preferencesStore.setActiveNetwork>[0]) {
        writes += 1;
        if (writes > 1) throw new Error("storage unavailable");
        return preferencesStore.setActiveNetwork(networkId);
      },
    };
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);

    await expect(
      runUnlockedNetworkMutation(session, failingUndo, "SN_SEPOLIA", async () => {
        throw new RefusedBeforeWrite(VAULT_FULL);
      }),
    ).rejects.toThrow(VAULT_FULL);

    expect(session.peekPassphrase()).toBeNull();
  });
});
