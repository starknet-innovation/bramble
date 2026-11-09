/**
 * Edges of the local commit-record mirror (Sherlock #138): which store may
 * have one, interrupted writes followed by a lost `sync` record, a `sync` area
 * that refuses the write-back, and an interrupted abort of a v2 migration.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { migrateVault } from "@bramble/vault/migrations";
import {
  readMigratedVault,
  VAULT_MIGRATION_STORE_KEY,
  VAULT_STORE_KEY,
} from "@bramble/vault/store-migration";
import { legacyEnvelope, vaultV3 } from "./legacy-envelope";

const passphrase = "correct horse battery staple";
const scope = `bramble:encrypted-store:${VAULT_STORE_KEY}`;
const legacyKey = `${VAULT_STORE_KEY}:legacy`;

const lineageOf = (envelope: unknown): string => (envelope as { readonly lineage: string }).lineage;

// A memory store that can be copied and restored whole, like a backup of
// `storage.local`.
const snapshotStore = () => {
  const keys = new Set<string>();
  const target = createMemoryStore();
  const store: KeyValueStore = {
    get: (key) => target.get(key),
    async remove(key) {
      keys.delete(key);
      await target.remove(key);
    },
    async set(key, value) {
      keys.add(key);
      await target.set(key, value);
    },
  };
  const copy = async (): Promise<ReadonlyMap<string, Json>> => {
    const entries = new Map<string, Json>();
    for (const key of keys) {
      entries.set(key, (await target.get(key)) as Json);
    }
    return entries;
  };
  const restore = async (entries: ReadonlyMap<string, Json>): Promise<void> => {
    for (const key of [...keys]) {
      await store.remove(key);
    }
    for (const [key, value] of entries) {
      await store.set(key, value);
    }
  };
  return { copy, restore, store };
};

describe("the migration staging store", () => {
  // The wallet removes the staging record from `sync` after every migration,
  // so a staging mirror would be the only authority left for a staged copy in
  // a restored `local`, and would vouch for it.
  test("has no mirror, so a restored mid-migration copy of local cannot replace the vault", async () => {
    const local = snapshotStore();
    const sync = createMemoryStore();
    const wire = () => {
      const session = createMemoryStore();
      return {
        primary: createEncryptedStore(local.store, VAULT_STORE_KEY, sync, session, true),
        staging: createEncryptedStore(local.store, VAULT_MIGRATION_STORE_KEY, sync, session),
      };
    };
    let stores = wire();
    await stores.primary.write(vaultV3, passphrase);
    const migrated = migrateVault(vaultV3);
    await stores.staging.write(migrated, passphrase);
    const backup = await local.copy();

    await stores.primary.write(migrated, passphrase);
    await stores.staging.remove();
    const rotated = "rotated passphrase after the old one leaked";
    await stores.primary.write(migrated, rotated);

    stores = wire();
    await local.restore(backup);
    await local.store.set(VAULT_STORE_KEY, { corrupted: true });

    await expect(readMigratedVault(stores, passphrase)).rejects.toThrow(
      "Invalid encrypted store envelope",
    );
  });
});

describe("an interrupted write followed by a lost sync record", () => {
  test("keeps the last value that reached the envelope readable from the mirror", async () => {
    // Writes: pending mirror, pending durable, envelope, promoted mirror,
    // promoted durable.
    for (const failAt of [1, 2, 3, 4, 5]) {
      const local = createMemoryStore();
      const sync = createMemoryStore();
      let writes = 0;
      let armed = false;
      const faulting = (target: KeyValueStore): KeyValueStore => ({
        get: (key) => target.get(key),
        remove: (key) => target.remove(key),
        async set(key, value) {
          writes += 1;
          if (armed && writes === failAt) {
            armed = false;
            throw new Error(`injected commit write ${failAt}`);
          }
          await target.set(key, value);
        },
      });
      const encrypted = createEncryptedStore(
        faulting(local),
        VAULT_STORE_KEY,
        faulting(sync),
        undefined,
        true,
      );
      await encrypted.write({ revision: 1 }, passphrase);
      writes = 0;
      armed = true;
      await expect(encrypted.write({ revision: 2 }, passphrase)).rejects.toThrow(
        `injected commit write ${failAt}`,
      );

      await sync.remove(`${VAULT_STORE_KEY}:commit:${lineageOf(await local.get(VAULT_STORE_KEY))}`);
      const restarted = createEncryptedStore(local, VAULT_STORE_KEY, sync, undefined, true);

      expect(await restarted.read(passphrase)).toEqual({ revision: failAt > 3 ? 2 : 1 });
    }
  });
});

describe("a sync area that refuses the write-back", () => {
  test("does not turn a mirror-vouched read back into a lockout", async () => {
    const local = createMemoryStore();
    const sync = createMemoryStore();
    await createEncryptedStore(local, VAULT_STORE_KEY, sync, undefined, true).write(
      { revision: 1 },
      passphrase,
    );
    await sync.remove(`${VAULT_STORE_KEY}:commit:${lineageOf(await local.get(VAULT_STORE_KEY))}`);
    const full: KeyValueStore = {
      get: (key) => sync.get(key),
      remove: (key) => sync.remove(key),
      set: () => Promise.reject(new Error("QUOTA_BYTES quota exceeded")),
    };

    const encrypted = createEncryptedStore(local, VAULT_STORE_KEY, full, undefined, true);

    expect(await encrypted.read(passphrase)).toEqual({ revision: 1 });
  });
});

describe("an interrupted abort of a v2 migration", () => {
  // A crash after a v2-to-v3 migration wrote its pending records and marker but
  // before the envelope leaves the v2 vault with a marker. The next read aborts
  // that migration; a crash during the abort must not leave the marker behind
  // without the records it names, which would refuse the v2 vault for good.
  test("leaves the v2 vault readable when the abort is itself interrupted", async () => {
    const local = createMemoryStore();
    const sync = createMemoryStore();
    let writes = 0;
    let failWrite = 0;
    let failMarkerRemoval = false;
    const faultingLocal: KeyValueStore = {
      get: (key) => local.get(key),
      async remove(key) {
        if (failMarkerRemoval && key === legacyKey) {
          failMarkerRemoval = false;
          throw new Error("injected marker removal");
        }
        await local.remove(key);
      },
      async set(key, value) {
        writes += 1;
        if (writes === failWrite) {
          throw new Error("injected envelope write");
        }
        await local.set(key, value);
      },
    };
    await local.set(
      VAULT_STORE_KEY,
      (await legacyEnvelope({ revision: 1 }, passphrase, scope)) as Json,
    );
    const encrypted = createEncryptedStore(faultingLocal, VAULT_STORE_KEY, sync, undefined, true);
    // Local writes during the upgrade: the pending mirror, the marker, the envelope.
    failWrite = 3;
    await expect(encrypted.upgradeLegacyEnvelope(passphrase)).rejects.toThrow(
      "injected envelope write",
    );
    failWrite = 0;
    expect(await local.get(legacyKey)).toBeDefined();

    failMarkerRemoval = true;
    await expect(encrypted.read(passphrase)).rejects.toThrow("injected marker removal");

    expect(await encrypted.read(passphrase)).toEqual({ revision: 1 });
  });
});

describe("a mirror the session shadow refuses", () => {
  // `storage.sync` syncs to the browser account, so a refused record copied
  // there would overwrite the newer one and vouch for the rollback after the
  // next restart, when there is no shadow left to disagree.
  test("is never copied back to sync", async () => {
    const local = createMemoryStore();
    const sync = createMemoryStore();
    const session = createMemoryStore();
    const encrypted = createEncryptedStore(local, VAULT_STORE_KEY, sync, session, true);
    await encrypted.write({ revision: 1 }, passphrase);
    const envelope = await local.get(VAULT_STORE_KEY);
    const commitKey = `${VAULT_STORE_KEY}:commit:${lineageOf(envelope)}`;
    const staleMirror = await local.get(commitKey);
    await encrypted.write({ revision: 2 }, passphrase);

    await sync.remove(commitKey);
    await local.set(VAULT_STORE_KEY, envelope as Json);
    await local.set(commitKey, staleMirror as Json);

    await expect(encrypted.read(passphrase)).rejects.toThrow("Encrypted store rollback detected");
    expect(await sync.get(commitKey)).toBeUndefined();
  });
});
