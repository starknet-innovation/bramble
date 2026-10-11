/**
 * The version-2 downgrade marker on installs that share `storage.sync`
 * (Sherlock #205).
 *
 * Every synced install of this extension shares one `storage.sync` area: on
 * Firefox always, because the add-on id is fixed. The store-wide marker that
 * refuses a version-2 envelope once a version-3 commit exists used to live
 * there, so one install's first write refused another install's own,
 * never-migrated vault as a rollback. The marker now lives beside the envelope
 * it protects, and still refuses a downgrade on the install that wrote it.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import {
  readMigratedVault,
  VAULT_MIGRATION_STORE_KEY,
  VAULT_STORE_KEY,
} from "@bramble/vault/store-migration";
import { legacyEnvelope } from "./legacy-envelope";

const passA = "device A passphrase for tests";
const passB = "correct horse battery staple";
const scope = `bramble:encrypted-store:${VAULT_STORE_KEY}`;
const legacyKey = `${VAULT_STORE_KEY}:legacy`;

const account = {
  address: "0x123",
  classHash: "0xabc",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
  id: "SN_MAIN:0x123",
  networkId: "SN_MAIN" as const,
  publicKeyX: "0x456",
  publicKeyY: "0x789",
};
// A schema-3 vault, as a pre-0.9.2 install would hold, for the unlock path.
const vaultV3 = {
  accounts: [account],
  activeAccountId: account.id,
  mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
  originGrants: [],
  schemaVersion: 3 as const,
  signingKeys: [{ accountId: account.id, privateKey: "0x654321" }],
};

// One install wired like `background/index.ts`, sharing `sync` with the others.
const install = (sync: KeyValueStore) => {
  const local = createMemoryStore();
  const session = createMemoryStore();
  return {
    local,
    primary: createEncryptedStore(local, VAULT_STORE_KEY, sync, session),
    staging: createEncryptedStore(local, VAULT_MIGRATION_STORE_KEY, sync, session),
  };
};

const versionOf = async (store: KeyValueStore): Promise<unknown> =>
  ((await store.get(VAULT_STORE_KEY)) as { readonly version: number }).version;

describe("another synced install's write", () => {
  test("leaves this install's own version-2 vault readable, upgradable and writable", async () => {
    const sync = createMemoryStore();
    const deviceA = install(sync);
    const deviceB = install(sync);
    await deviceB.local.set(
      VAULT_STORE_KEY,
      (await legacyEnvelope({ owner: "B" }, passB, scope)) as Json,
    );

    await deviceA.primary.write({ owner: "A" }, passA);

    expect(await sync.get(legacyKey)).toBeUndefined();
    expect(await deviceB.primary.read(passB)).toEqual({ owner: "B" });
    await deviceB.primary.upgradeLegacyEnvelope(passB);
    expect(await versionOf(deviceB.local)).toBe(3);
    await deviceB.primary.write({ edited: true, owner: "B" }, passB);
    expect(await deviceB.primary.read(passB)).toEqual({ edited: true, owner: "B" });
  });

  test("lets the second of two version-2 installs unlock after the first has migrated", async () => {
    const sync = createMemoryStore();
    const deviceA = install(sync);
    const deviceB = install(sync);
    await deviceA.local.set(VAULT_STORE_KEY, (await legacyEnvelope(vaultV3, passA, scope)) as Json);
    await deviceB.local.set(VAULT_STORE_KEY, (await legacyEnvelope(vaultV3, passB, scope)) as Json);

    await readMigratedVault(deviceA, passA);
    expect(await versionOf(deviceA.local)).toBe(3);

    expect((await readMigratedVault(deviceB, passB)).activeAccountId).toBe(account.id);
    expect(await versionOf(deviceB.local)).toBe(3);
  });
});

describe("a downgrade on the install that migrated", () => {
  test("is still refused, after a restart too", async () => {
    const sync = createMemoryStore();
    const device = install(sync);
    const legacy = await legacyEnvelope({ revision: 1 }, passB, scope);
    await device.local.set(VAULT_STORE_KEY, legacy as Json);
    await device.primary.upgradeLegacyEnvelope(passB);

    await device.local.set(VAULT_STORE_KEY, legacy as Json);
    const restarted = createEncryptedStore(
      device.local,
      VAULT_STORE_KEY,
      sync,
      createMemoryStore(),
    );

    await expect(restarted.read(passB)).rejects.toThrow("Encrypted store rollback detected");
  });

  test("is refused for an install migrated by an earlier release, once it has read its vault", async () => {
    const sync = createMemoryStore();
    const device = install(sync);
    const legacy = await legacyEnvelope({ revision: 1 }, passB, scope);
    await device.local.set(VAULT_STORE_KEY, legacy as Json);
    await device.primary.upgradeLegacyEnvelope(passB);
    const lineage = ((await device.local.get(VAULT_STORE_KEY)) as { readonly lineage: string })
      .lineage;
    // The state an earlier release left: the marker in the shared area only.
    await device.local.remove(legacyKey);
    await sync.set(legacyKey, { lineage, version: 1 });

    const restarted = createEncryptedStore(
      device.local,
      VAULT_STORE_KEY,
      sync,
      createMemoryStore(),
    );
    expect(await restarted.read(passB)).toEqual({ revision: 1 });

    expect(await device.local.get(legacyKey)).toEqual({ lineage, version: 1 });
    expect(await sync.get(legacyKey)).toBeUndefined();
    await device.local.set(VAULT_STORE_KEY, legacy as Json);
    const again = createEncryptedStore(device.local, VAULT_STORE_KEY, sync, createMemoryStore());
    await expect(again.read(passB)).rejects.toThrow("Encrypted store rollback detected");
  });

  test("leaves a shared marker that names another install's lineage in place", async () => {
    const sync = createMemoryStore();
    const device = install(sync);
    const foreign = { lineage: "0".repeat(32), version: 1 };
    await sync.set(legacyKey, foreign);

    await device.primary.write({ revision: 1 }, passB);
    expect(await device.primary.read(passB)).toEqual({ revision: 1 });

    expect(await sync.get(legacyKey)).toEqual(foreign);
  });
});
