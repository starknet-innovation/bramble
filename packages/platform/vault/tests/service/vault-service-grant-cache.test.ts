/**
 * The in-memory grant projection behind `getGrantedAccounts` (Sherlock 135).
 *
 * A dapp's passive grant query answered at once while locked but waited on a
 * full vault read while unlocked, so its latency told any page the lock state.
 * Grants are now served from memory between writes. These tests pin that the
 * cache is used, that every write and the lock drop it, and that it never
 * answers for a different password or holds a value a concurrent write
 * replaced.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore, type EncryptedStore } from "@bramble/vault/encrypted-store";
import type { KmsPort } from "@bramble/vault/kms-port";
import type { Vault } from "@bramble/vault/schema";
import { createWalletVaultService } from "@bramble/vault/service";
import { createGrantCache } from "../../src/service/grant-cache";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultPassphrase = "correct horse battery staple";
const origin = "https://dapp.example";

// Keypairs vary by account index so derived accounts stay distinct.
const indexedKms = (): KmsPort => ({
  ...fakeKms(),
  async deriveStarknetKeypair(_mnemonic, _addressIndex, accountIndex) {
    return {
      privateKey: `0x1234${accountIndex + 1}`,
      publicKeyX: `0xabc${accountIndex}`,
      publicKeyY: "0xdef",
    };
  },
});

const counting = (store: EncryptedStore) => {
  let reads = 0;
  return {
    reads: () => reads,
    store: {
      ...store,
      read: (password: string) => {
        reads += 1;
        return store.read(password);
      },
    } satisfies EncryptedStore,
  };
};

const unlocked = async () => {
  const primary = counting(createEncryptedStore(createMemoryStore(), "bramble:vault"));
  const service = createWalletVaultService({
    encryptedStore: primary.store,
    kms: indexedKms(),
    migrationStore: createEncryptedStore(createMemoryStore(), "bramble:vault-migration"),
  });
  const account = await service.createAccount({
    accountContractType: "openzeppelin",
    mnemonic,
    vaultPassphrase,
  });
  await service.grantOrigin({ origin, vaultPassphrase });
  // Unlocking reads the vault, which fills the cache.
  await service.readVault(vaultPassphrase);
  return { account, reads: primary.reads, service };
};

describe("getGrantedAccounts", () => {
  test("answers from memory after the unlock read, without reading the store", async () => {
    const { account, reads, service } = await unlocked();
    const before = reads();

    await expect(service.getGrantedAccounts(origin, vaultPassphrase)).resolves.toEqual([account]);
    await expect(
      service.getGrantedAccounts("https://other.example", vaultPassphrase),
    ).resolves.toEqual([]);

    expect(reads()).toBe(before);
  });

  test("reflects a revoked grant at once", async () => {
    const { service } = await unlocked();
    await service.revokeOrigin({ origin, vaultPassphrase });
    await expect(service.getGrantedAccounts(origin, vaultPassphrase)).resolves.toEqual([]);
  });

  test("reflects a new grant at once", async () => {
    const { account, service } = await unlocked();
    const other = "https://other.example";
    await service.grantOrigin({ origin: other, vaultPassphrase });
    await expect(service.getGrantedAccounts(other, vaultPassphrase)).resolves.toEqual([account]);
  });

  test("reflects a switch of the active account at once", async () => {
    const { service } = await unlocked();
    const second = await service.addDerivedAccount({
      accountContractType: "openzeppelin",
      networkId: "SN_MAIN",
      vaultPassphrase,
    });
    await service.setActiveAccount({ accountId: second.id, vaultPassphrase });
    await expect(service.getGrantedAccounts(origin, vaultPassphrase)).resolves.toEqual([]);
  });

  test("never answers a different password from memory", async () => {
    const { service } = await unlocked();
    await expect(
      service.getGrantedAccounts(origin, "wrong horse battery staple"),
    ).rejects.toThrow();
  });

  test("reads the store again after the lock clears the cache", async () => {
    const { account, reads, service } = await unlocked();
    service.clearGrantCache();
    const before = reads();

    await expect(service.getGrantedAccounts(origin, vaultPassphrase)).resolves.toEqual([account]);

    expect(reads()).toBe(before + 1);
  });
});

describe("createGrantCache", () => {
  const vault = {
    accounts: [],
    activeAccountId: null,
    originGrants: [{ accountIds: ["a"], origin }],
  } as unknown as Vault;

  test("drops a read that a write started or finished during", async () => {
    const cache = createGrantCache();
    let release: () => void = () => undefined;
    const store = cache.watch({
      write: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    } as unknown as EncryptedStore);

    const startedAt = cache.generation();
    const writing = store.write({}, vaultPassphrase);
    cache.remember(vaultPassphrase, vault, startedAt);
    expect(cache.lookup(vaultPassphrase)).toBeUndefined();

    const duringWrite = cache.generation();
    release();
    await writing;
    cache.remember(vaultPassphrase, vault, duringWrite);
    expect(cache.lookup(vaultPassphrase)).toBeUndefined();

    cache.remember(vaultPassphrase, vault, cache.generation());
    expect(cache.lookup(vaultPassphrase)?.originGrants).toEqual(vault.originGrants);
  });

  test("invalidates on remove and on clearing the keys", async () => {
    const cache = createGrantCache();
    const store = cache.watch({
      clearKeys: () => undefined,
      remove: async () => undefined,
    } as unknown as EncryptedStore);

    cache.remember(vaultPassphrase, vault, cache.generation());
    await store.remove();
    expect(cache.lookup(vaultPassphrase)).toBeUndefined();

    cache.remember(vaultPassphrase, vault, cache.generation());
    store.clearKeys();
    expect(cache.lookup(vaultPassphrase)).toBeUndefined();
  });

  test("keeps no secret material, only what grant resolution reads", () => {
    const cache = createGrantCache();
    cache.remember(
      vaultPassphrase,
      { ...vault, accountSecrets: [{ x: 1 }], mnemonic } as unknown as Vault,
      cache.generation(),
    );
    expect(Object.keys(cache.lookup(vaultPassphrase) ?? {}).sort()).toEqual([
      "accounts",
      "activeAccountId",
      "originGrants",
    ]);
  });
});
