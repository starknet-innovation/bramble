/**
 * An origin grant whose authorization lapses mid-write (Sherlock 255).
 *
 * `grantOrigin` re-checks authorization after encryption, immediately before
 * the first storage write, so a lock during key derivation leaves nothing
 * stored and nothing to roll back. Only a lock during the storage writes
 * themselves still takes the rollback, which is a second, best-effort write.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { createWalletVaultService } from "@bramble/vault/service";

const vaultKey = "bramble:vault";
const migrationKey = "bramble:vault-migration";
const vaultPassphrase = "correct horse battery staple";
const origin = "https://example.com";

// A store that counts writes and can be made to fail them.
const countingStore = () => {
  const inner = createMemoryStore();
  const state = { failWrites: false, writes: 0 };
  const store: KeyValueStore = {
    get: (key) => inner.get(key),
    remove: (key) => inner.remove(key),
    async set(key, value: Json) {
      if (state.failWrites) {
        throw new Error("storage unavailable");
      }
      state.writes += 1;
      await inner.set(key, value);
    },
  };
  return { state, store };
};

const setup = async () => {
  const local = countingStore();
  const sync = countingStore();
  const service = createWalletVaultService({
    encryptedStore: createEncryptedStore(local.store, vaultKey, sync.store),
    kms: fakeKms(),
    migrationStore: createEncryptedStore(local.store, migrationKey, sync.store),
  });
  await service.createAccount({
    accountContractType: "openzeppelin",
    mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
    vaultPassphrase,
  });
  return { local, service, sync };
};

// Authorized for the first `passing` checks, then locked. grantOrigin checks
// before reading the vault, before encrypting, right before the first storage
// write, and once the write has finished.
const lapsingAfter = (passing: number) => {
  let checks = 0;
  return () => {
    checks += 1;
    return checks <= passing;
  };
};

describe("grantOrigin authorization window", () => {
  test("a lock during encryption stores nothing at all", async () => {
    const { local, service, sync } = await setup();
    const before = await local.store.get(vaultKey);
    local.state.writes = 0;
    sync.state.writes = 0;

    await expect(
      service.grantOrigin({ isAuthorized: lapsingAfter(2), origin, vaultPassphrase }),
    ).rejects.toThrow("wallet locked");

    expect(local.state.writes).toBe(0);
    expect(sync.state.writes).toBe(0);
    expect(await local.store.get(vaultKey)).toEqual(before);
    expect((await service.readVault(vaultPassphrase)).originGrants).toEqual([]);
  });

  test("a lock during the storage writes is rolled back", async () => {
    const { service } = await setup();

    await expect(
      service.grantOrigin({ isAuthorized: lapsingAfter(3), origin, vaultPassphrase }),
    ).rejects.toThrow("wallet locked");

    expect((await service.readVault(vaultPassphrase)).originGrants).toEqual([]);
  });

  test("a failed rollback reports its storage error, not a lock", async () => {
    const { local, service } = await setup();
    let checks = 0;

    await expect(
      service.grantOrigin({
        isAuthorized: () => {
          checks += 1;
          if (checks === 4) {
            local.state.failWrites = true;
          }
          return checks <= 3;
        },
        origin,
        vaultPassphrase,
      }),
    ).rejects.toThrow("storage unavailable");

    local.state.failWrites = false;
    expect((await service.readVault(vaultPassphrase)).originGrants).toEqual([
      { accountIds: expect.any(Array), origin },
    ]);
  });

  test("an authorization that holds stores the grant", async () => {
    const { service } = await setup();
    await service.grantOrigin({ isAuthorized: () => true, origin, vaultPassphrase });
    expect((await service.readVault(vaultPassphrase)).originGrants).toHaveLength(1);
  });
});
