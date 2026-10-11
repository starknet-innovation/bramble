/**
 * Losing the durable commit record (Sherlock #138).
 *
 * Production keeps the envelope in `storage.local` and its commit record in
 * `storage.sync`. A sync-account change, a profile reset or quota eviction can
 * drop the sync record while the envelope survives, and a missing record used
 * to make every read and write throw for good. The record now has a mirror
 * beside the envelope, consulted only when the sync record is absent, so that
 * loss is survivable while a rolled-back `local` is still refused whenever
 * `sync` holds the newer record.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import { createMemoryStore } from "@bramble/store/kv";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";

const vaultKey = "bramble:vault";
const passphrase = "correct horse battery staple";

const lineageOf = (envelope: unknown): string => (envelope as { readonly lineage: string }).lineage;

// One install wired like `background/index.ts`: envelope in `local`, durable
// record in `sync`, shadow in `session`.
const install = () => {
  const local = createMemoryStore();
  const sync = createMemoryStore();
  const session = createMemoryStore();
  return {
    local,
    session,
    store: createEncryptedStore(local, vaultKey, sync, session, true),
    sync,
  };
};

describe("a lost sync commit record", () => {
  test("is restored from the local mirror, and the vault stays readable and writable", async () => {
    const { local, store, sync } = install();
    await store.write({ revision: 1 }, passphrase);
    const commitKey = `${vaultKey}:commit:${lineageOf(await local.get(vaultKey))}`;
    const record = await sync.get(commitKey);
    expect(await local.get(commitKey)).toEqual(record as Json);

    await sync.remove(commitKey);

    expect(await store.read(passphrase)).toEqual({ revision: 1 });
    expect(await sync.get(commitKey)).toEqual(record as Json);
    await store.write({ revision: 2 }, passphrase);
    expect(await store.read(passphrase)).toEqual({ revision: 2 });
  });

  test("is restored after a browser restart, with no session shadow to lean on", async () => {
    const { local, store, sync } = install();
    await store.write({ revision: 1 }, passphrase);
    await sync.remove(`${vaultKey}:commit:${lineageOf(await local.get(vaultKey))}`);

    const restarted = createEncryptedStore(local, vaultKey, sync, createMemoryStore(), true);

    expect(await restarted.read(passphrase)).toEqual({ revision: 1 });
  });

  test("survives for an install whose records predate the mirror once it has been read", async () => {
    const { local, store, sync } = install();
    await store.write({ revision: 1 }, passphrase);
    const commitKey = `${vaultKey}:commit:${lineageOf(await local.get(vaultKey))}`;
    // The state an earlier release left: the record in `sync` only.
    await local.remove(commitKey);

    expect(await store.read(passphrase)).toEqual({ revision: 1 });
    expect(await local.get(commitKey)).toEqual((await sync.get(commitKey)) as Json);

    await sync.remove(commitKey);
    expect(await store.read(passphrase)).toEqual({ revision: 1 });
  });

  test("still fails closed when the mirror is missing too", async () => {
    const { local, store, sync } = install();
    await store.write({ revision: 1 }, passphrase);
    const commitKey = `${vaultKey}:commit:${lineageOf(await local.get(vaultKey))}`;
    await sync.remove(commitKey);
    await local.remove(commitKey);

    await expect(store.read(passphrase)).rejects.toThrow("Encrypted store commit state missing");
  });
});

describe("the local mirror does not reopen local rollback", () => {
  test("refuses a local profile rolled back with its mirror while sync holds the newer record", async () => {
    const { local, store } = install();
    await store.write({ revision: 1 }, passphrase);
    const envelope = await local.get(vaultKey);
    const commitKey = `${vaultKey}:commit:${lineageOf(envelope)}`;
    const staleMirror = await local.get(commitKey);
    await store.write({ revision: 2 }, passphrase);

    // A restored backup of `storage.local`: the old envelope and the old
    // mirror, which still vouches for it.
    await local.set(vaultKey, envelope as Json);
    await local.set(commitKey, staleMirror as Json);

    await expect(store.read(passphrase)).rejects.toThrow("Encrypted store rollback detected");
  });

  test("refuses the rolled-back profile after a restart, when only the sync record is left", async () => {
    const { local, store, sync } = install();
    await store.write({ revision: 1 }, passphrase);
    const envelope = await local.get(vaultKey);
    const commitKey = `${vaultKey}:commit:${lineageOf(envelope)}`;
    const staleMirror = await local.get(commitKey);
    await store.write({ revision: 2 }, passphrase);
    await local.set(vaultKey, envelope as Json);
    await local.set(commitKey, staleMirror as Json);

    const restarted = createEncryptedStore(local, vaultKey, sync, createMemoryStore(), true);

    await expect(restarted.read(passphrase)).rejects.toThrow("Encrypted store rollback detected");
    // The sync record governed, and the stale mirror was brought back in line with it.
    expect(await local.get(commitKey)).toEqual((await sync.get(commitKey)) as Json);
  });
});

describe("removing the store", () => {
  test("removes the mirror along with the durable record", async () => {
    const { local, store, sync } = install();
    await store.write({ revision: 1 }, passphrase);
    const commitKey = `${vaultKey}:commit:${lineageOf(await local.get(vaultKey))}`;

    await store.remove();

    expect(await local.get(commitKey)).toBeUndefined();
    expect(await sync.get(commitKey)).toBeUndefined();
  });
});
