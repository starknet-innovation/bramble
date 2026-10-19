/**
 * The vault's capacity (Sherlock 261).
 *
 * The vault validators apply the provider JSON budget on read as on write, so
 * that budget is the vault's one capacity: anything it accepts is stored and
 * read back, and the first vault past it is refused by name before any storage
 * is touched. The at-rest storage budget is wide enough for the envelope of
 * anything the vault accepts, so it never refuses a vault halfway through a
 * commit; an envelope it does refuse is refused before the pending record.
 */
import { describe, expect, test } from "bun:test";
import { RefusedBeforeWrite } from "@bramble/core/errors";
import type { Json } from "@bramble/core/json";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { isVaultV12 } from "@bramble/vault/schema";
import { createWalletVaultService } from "@bramble/vault/service";
import { writeVault } from "../../src/service/service-creation";
import { VAULT_FULL } from "../../src/service/vault-capacity";
import { capacity, vaultWith } from "./vault-fixture";

const vaultKey = "bramble:vault";
const vaultPassphrase = "correct horse battery staple";

const snapshot = async (store: KeyValueStore, keys: readonly string[]) =>
  Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await store.get(key)])));

describe("vault capacity", () => {
  test("is the shared JSON budget, a couple of hundred accounts", () => {
    expect(isVaultV12(vaultWith(2))).toBe(true);
    // Measured at 243 derived accounts before any connected sites, imported
    // phrases or retained secrets share the budget. The storage budget used to
    // refuse the envelope first, at 184.
    expect(capacity()).toBeGreaterThanOrEqual(240);
  });

  test("a vault at capacity is stored and read back through the real store", async () => {
    const vault = vaultWith(capacity());
    const store = createEncryptedStore(createMemoryStore(), vaultKey, createMemoryStore());
    await writeVault(store, vault, vaultPassphrase);
    expect(await store.read(vaultPassphrase)).toEqual(vault);
  });

  test("one account past capacity is refused by name with nothing stored", async () => {
    const local = createMemoryStore();
    const sync = createMemoryStore();
    const store = createEncryptedStore(local, vaultKey, sync);
    const small = vaultWith(1);
    await writeVault(store, small, vaultPassphrase);
    const lineage = ((await local.get(vaultKey)) as { readonly lineage: string }).lineage;
    const keys = [vaultKey, `${vaultKey}:commit:${lineage}`];
    const before = { local: await snapshot(local, keys), sync: await snapshot(sync, keys) };

    await expect(writeVault(store, vaultWith(capacity() + 1), vaultPassphrase)).rejects.toThrow(
      VAULT_FULL,
    );

    expect({ local: await snapshot(local, keys), sync: await snapshot(sync, keys) }).toEqual(
      before,
    );
    expect(await store.read(vaultPassphrase)).toEqual(small);
  });
});

describe("importing a phrase into a full vault", () => {
  test("is refused as full, before anything is stored, not as an invalid vault", async () => {
    const local = createMemoryStore();
    const store = createEncryptedStore(local, vaultKey);
    const full = vaultWith(capacity());
    await writeVault(store, full, vaultPassphrase);
    const service = createWalletVaultService({
      encryptedStore: store,
      kms: fakeKms(),
      migrationStore: createEncryptedStore(local, "bramble:vault-migration"),
    });

    const refusal = service.importSeedAccounts({
      mnemonic: "legal winner thank year wave sausage worth useful legal winner thank yellow",
      networkId: "SN_MAIN",
      selections: [{ accountContractType: "openzeppelin", accountIndex: 0 }],
      vaultPassphrase,
    });

    await expect(refusal).rejects.toBeInstanceOf(RefusedBeforeWrite);
    await expect(refusal).rejects.toThrow(VAULT_FULL);
    expect(await store.read(vaultPassphrase)).toEqual(full);
  });
});

describe("an envelope the storage budget refuses", () => {
  // Not a vault: a value the store's own plaintext check admits whose
  // envelope is still too large, which only a non-vault caller can produce.
  const oversized: Json = "x".repeat(1_100_000);

  test("is refused before the pending record, on a first write", async () => {
    const local = createMemoryStore();
    const sync = createMemoryStore();
    const writes: string[] = [];
    const watchedSync: KeyValueStore = {
      ...sync,
      set: async (key, value) => {
        writes.push(key);
        await sync.set(key, value);
      },
    };
    const store = createEncryptedStore(local, vaultKey, watchedSync);

    await expect(store.write(oversized, vaultPassphrase)).rejects.toThrow("Invalid JSON value");

    expect(writes).toEqual([]);
    expect(await local.get(vaultKey)).toBeUndefined();
  });

  test("leaves the committed vault and its record untouched", async () => {
    const local = createMemoryStore();
    const sync = createMemoryStore();
    const store = createEncryptedStore(local, vaultKey, sync);
    await store.write({ kept: true }, vaultPassphrase);
    const lineage = ((await local.get(vaultKey)) as { readonly lineage: string }).lineage;
    const record = await sync.get(`${vaultKey}:commit:${lineage}`);

    await expect(store.write(oversized, vaultPassphrase)).rejects.toThrow("Invalid JSON value");

    expect(await sync.get(`${vaultKey}:commit:${lineage}`)).toEqual(record);
    expect(await store.read(vaultPassphrase)).toEqual({ kept: true });
  });
});
