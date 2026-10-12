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
import { isJson, type Json } from "@bramble/core/json";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { emptyVault, isVaultV11, type Vault } from "@bramble/vault/schema";
import { VAULT_FULL, writeVault } from "../../src/service/service-creation";

const vaultKey = "bramble:vault";
const vaultPassphrase = "correct horse battery staple";

// Full-width felts, as real addresses and keys are; 63 hex digits keep them
// canonical and below both the field prime and the curve order.
const felt = (index: number, salt: bigint): string =>
  `0x7${((BigInt(index) + 1n) * 0x9e3779b97f4a7c15n * salt).toString(16).padStart(62, "0").slice(-62)}`;

// Derived accounts shaped as the service stores them, each with its signing key.
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

// The largest account count the vault validators accept.
const capacity = (): number => {
  let low = 1;
  let high = 2_000;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (isJson(vaultWith(middle))) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
};

const snapshot = async (store: KeyValueStore, keys: readonly string[]) =>
  Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await store.get(key)])));

describe("vault capacity", () => {
  test("is the shared JSON budget, a couple of hundred accounts", () => {
    expect(isVaultV11(vaultWith(2))).toBe(true);
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
