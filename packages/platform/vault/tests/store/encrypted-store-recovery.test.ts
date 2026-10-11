/**
 * Recovering a vault the store cannot verify (Sherlock #138).
 *
 * `health` says, without the passphrase, whether the stored envelope can be
 * opened, so the panel can offer recovery instead of an unlock that cannot
 * succeed. `readUnverified` and `replaceUnverified` accept a possibly older
 * copy after the user consents; they refuse to run on a vault that is fine,
 * and the replacement is protected by fresh records like any other write.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import { createMemoryStore } from "@bramble/store/kv";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { legacyEnvelope } from "./legacy-envelope";

const vaultKey = "bramble:vault";
const passphrase = "correct horse battery staple";

const lineageOf = (envelope: unknown): string => (envelope as { readonly lineage: string }).lineage;

const install = () => {
  const local = createMemoryStore();
  const sync = createMemoryStore();
  const open = () => createEncryptedStore(local, vaultKey, sync, createMemoryStore(), true);
  return { local, open, store: open(), sync };
};

// A vault whose records are gone from both `sync` and the local mirror.
const unverifiedInstall = async () => {
  const parts = install();
  await parts.store.write({ revision: 1 }, passphrase);
  const commitKey = `${vaultKey}:commit:${lineageOf(await parts.local.get(vaultKey))}`;
  await parts.sync.remove(commitKey);
  await parts.local.remove(commitKey);
  return { ...parts, store: parts.open() };
};

// A vault whose `local` was restored from a copy older than `sync` knows of.
const rolledBackInstall = async () => {
  const parts = install();
  await parts.store.write({ revision: 1 }, passphrase);
  const envelope = await parts.local.get(vaultKey);
  const commitKey = `${vaultKey}:commit:${lineageOf(envelope)}`;
  const mirror = await parts.local.get(commitKey);
  await parts.store.write({ revision: 2 }, passphrase);
  await parts.local.set(vaultKey, envelope as Json);
  await parts.local.set(commitKey, mirror as Json);
  return { ...parts, envelope, store: parts.open() };
};

describe("health", () => {
  test("is absent with nothing stored, and ok for a vault that verifies", async () => {
    const { store } = install();
    expect(await store.health()).toBe("absent");
    await store.write({ revision: 1 }, passphrase);
    expect(await store.health()).toBe("ok");
  });

  test("is unverified when no authority holds the commit record", async () => {
    const { store } = await unverifiedInstall();
    expect(await store.health()).toBe("unverified");
  });

  test("is rollback when sync names a newer commit", async () => {
    const { store } = await rolledBackInstall();
    expect(await store.health()).toBe("rollback");
  });

  test("is rollback for a version-2 envelope on an install that has migrated", async () => {
    const { local, open, store } = install();
    await store.write({ revision: 1 }, passphrase);
    const scope = `bramble:encrypted-store:${vaultKey}`;
    await local.set(vaultKey, (await legacyEnvelope({ revision: 0 }, passphrase, scope)) as Json);
    expect(await open().health()).toBe("rollback");
  });

  test("is invalid for a malformed envelope, which remove still deletes", async () => {
    const { local, store } = install();
    await local.set(vaultKey, { corrupted: true });
    expect(await store.health()).toBe("invalid");

    await store.remove();

    expect(await store.exists()).toBe(false);
    expect(await store.health()).toBe("absent");
  });
});

describe("accepting an unverified vault", () => {
  test("refuses to run on a vault that verifies, or on none", async () => {
    const { store } = install();
    await expect(store.readUnverified(passphrase)).rejects.toThrow("not awaiting recovery");
    await store.write({ revision: 1 }, passphrase);
    await expect(store.readUnverified(passphrase)).rejects.toThrow("not awaiting recovery");
    await expect(store.replaceUnverified({ revision: 9 }, passphrase)).rejects.toThrow(
      "not awaiting recovery",
    );
    expect(await store.read(passphrase)).toEqual({ revision: 1 });
  });

  test("still needs the right passphrase", async () => {
    const { store } = await unverifiedInstall();
    await expect(store.readUnverified("wrong horse battery staple")).rejects.toThrow();
  });

  test("replaces an unverified vault under a fresh lineage that verifies", async () => {
    const { local, open, store, sync } = await unverifiedInstall();
    const before = lineageOf(await local.get(vaultKey));
    expect(await store.readUnverified(passphrase)).toEqual({ revision: 1 });

    await store.replaceUnverified({ recovered: true, revision: 1 }, passphrase);

    const after = lineageOf(await local.get(vaultKey));
    expect(after).not.toBe(before);
    expect(await open().health()).toBe("ok");
    expect(await open().read(passphrase)).toEqual({ recovered: true, revision: 1 });
    expect(await sync.get(`${vaultKey}:commit:${after}`)).toBeDefined();
  });

  test("replaces a rolled-back vault, drops the old lineage's records, and refuses its replay", async () => {
    const { envelope, local, open, store, sync } = await rolledBackInstall();
    const oldCommitKey = `${vaultKey}:commit:${lineageOf(envelope)}`;
    expect(await store.readUnverified(passphrase)).toEqual({ revision: 1 });

    await store.replaceUnverified({ recovered: true, revision: 1 }, passphrase);

    expect(await sync.get(oldCommitKey)).toBeUndefined();
    expect(await local.get(oldCommitKey)).toBeUndefined();
    expect(await open().read(passphrase)).toEqual({ recovered: true, revision: 1 });
    await local.set(vaultKey, envelope as Json);
    expect(await open().health()).not.toBe("ok");
  });
});
