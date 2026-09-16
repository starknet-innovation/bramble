/**
 * The session-scoped shadow of the commit state.
 *
 * The durable freshness authority is `storage.sync`. On Firefox this
 * extension's own content script can write it — Gecko implements no
 * `storage.setAccessLevel`, so neither `local` nor `sync` can be closed off —
 * and an attacker there rewrites the envelope and its commit state TOGETHER.
 * The pair stays self-consistent, so the durable check passes and the rollback
 * succeeds. These cases are the second authority that catches it: a copy in
 * `storage.session`, which no content script can reach on any browser.
 *
 * The protection is bounded and the last two cases say so: a session with no
 * shadow yet, and a runtime with no session storage, both fall back to the
 * durable record alone.
 */
import { describe, expect, test } from "bun:test";
import { isRecord, type Json } from "@bramble/core/json";
import { createMemoryStore } from "@bramble/store/kv";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";

const vaultKey = "bramble:vault";
const passphrase = "correct horse battery staple";

const randomBase64 = (length: number): string =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(length))));

// A structurally valid version-2 envelope. Its ciphertext is random because
// the reads below must be refused before decryption is attempted.
const legacyEnvelopeShape = (): Json => ({
  cipher: "AES-256-GCM",
  data: randomBase64(32),
  iterations: 600_000,
  iv: randomBase64(12),
  kdf: "PBKDF2-SHA-256",
  salt: randomBase64(16),
  scope: `bramble:encrypted-store:${vaultKey}`,
  version: 2,
});

describe("session commit shadow", () => {
  test("refuses an envelope rolled back together with its durable commit state", async () => {
    const store = createMemoryStore();
    const freshness = createMemoryStore();
    const session = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey, freshness, session);

    await encrypted.write({ revision: 1 }, passphrase);
    const envelope = await store.get(vaultKey);
    const lineage = (envelope as { readonly lineage: string }).lineage;
    const commitKey = `${vaultKey}:commit:${lineage}`;
    const staleCommitState = await freshness.get(commitKey);

    await encrypted.write({ revision: 2 }, passphrase);

    // The attack the shadow exists for: BOTH halves moved back, so the durable
    // authority still vouches for the envelope it is paired with.
    await store.set(vaultKey, envelope as Json);
    await freshness.set(commitKey, staleCommitState as Json);

    await expect(encrypted.read(passphrase)).rejects.toThrow("Encrypted store rollback detected");
  });

  test("still reads the current envelope after that consistent pair is restored", async () => {
    const store = createMemoryStore();
    const freshness = createMemoryStore();
    const session = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey, freshness, session);

    await encrypted.write({ revision: 1 }, passphrase);
    await encrypted.write({ revision: 2 }, passphrase);

    expect(await encrypted.read(passphrase)).toEqual({ revision: 2 });
  });

  test("writes the shadow forward so ordinary updates keep reading", async () => {
    const store = createMemoryStore();
    const freshness = createMemoryStore();
    const session = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey, freshness, session);

    for (const revision of [1, 2, 3, 4]) {
      await encrypted.write({ revision }, passphrase);
      expect(await encrypted.read(passphrase)).toEqual({ revision });
    }
  });

  // storage.session is cleared when the browser exits, so the first read of a
  // session has nothing to compare against. The shadow narrows the window; it
  // does not close it, and this is the gap stated plainly.
  test("accepts a rolled-back pair when the session holds no shadow yet", async () => {
    const store = createMemoryStore();
    const freshness = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey, freshness, createMemoryStore());

    await encrypted.write({ revision: 1 }, passphrase);
    const envelope = await store.get(vaultKey);
    const lineage = (envelope as { readonly lineage: string }).lineage;
    const commitKey = `${vaultKey}:commit:${lineage}`;
    const staleCommitState = await freshness.get(commitKey);
    await encrypted.write({ revision: 2 }, passphrase);

    await store.set(vaultKey, envelope as Json);
    await freshness.set(commitKey, staleCommitState as Json);

    // A fresh browser session: same durable stores, empty session storage.
    const afterRestart = createEncryptedStore(store, vaultKey, freshness, createMemoryStore());
    expect(await afterRestart.read(passphrase)).toEqual({ revision: 1 });
  });

  test("falls back to the durable authority alone without session storage", async () => {
    const store = createMemoryStore();
    const freshness = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey, freshness);

    await encrypted.write({ revision: 1 }, passphrase);
    expect(await encrypted.read(passphrase)).toEqual({ revision: 1 });
  });

  // A write records `{current, pending}` before the envelope and promotes it
  // after. A crash in between leaves the envelope naming the PENDING commit,
  // which is a legitimate interrupted write — not a rollback. A shadow that
  // accepted only `current` would refuse it and lock the vault out for good.
  test("accepts an envelope whose commit is still pending after an interrupted write", async () => {
    const store = createMemoryStore();
    const durable = createMemoryStore();
    const session = createMemoryStore();
    let promotions = 0;
    const freshness = {
      get: durable.get.bind(durable),
      remove: durable.remove.bind(durable),
      // Fails the SECOND promotion — the set that clears `pending` — so the
      // second write lands its envelope and its prepare record but never gets
      // promoted. Keyed on the transition rather than a call count, because
      // the legacy marker also passes through this store.
      async set(key: string, value: Json) {
        const promotion = isRecord(value) && value["pending"] === null;
        if (promotion) {
          promotions += 1;
          if (promotions === 2) {
            throw new Error("interrupted");
          }
        }
        await durable.set(key, value);
      },
    };
    const encrypted = createEncryptedStore(store, vaultKey, freshness, session);

    await encrypted.write({ revision: 1 }, passphrase);
    await expect(encrypted.write({ revision: 2 }, passphrase)).rejects.toThrow("interrupted");

    const state = (await durable.get(
      `${vaultKey}:commit:${((await store.get(vaultKey)) as { readonly lineage: string }).lineage}`,
    )) as { readonly pending: string | null };
    expect(state.pending).not.toBeNull();
    expect(await encrypted.read(passphrase)).toEqual({ revision: 2 });
  });

  test("clears the shadow when the record is removed", async () => {
    const store = createMemoryStore();
    const freshness = createMemoryStore();
    const session = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey, freshness, session);

    await encrypted.write({ revision: 1 }, passphrase);
    const lineage = ((await store.get(vaultKey)) as { readonly lineage: string }).lineage;
    const commitKey = `${vaultKey}:commit:${lineage}`;
    expect(await session.get(commitKey)).toBeDefined();

    await encrypted.remove();

    expect(await session.get(commitKey)).toBeUndefined();
    expect(await session.get(`${vaultKey}:promoted`)).toBeUndefined();
  });

  // The first read of a session has no shadow to check against, and it seeds
  // one with the commit it accepted. The unprotected window is that single
  // read, not the whole stretch until the next write.
  test("seeds the shadow on the first read so a later rollback in the session is refused", async () => {
    const store = createMemoryStore();
    const freshness = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey, freshness, createMemoryStore());

    await encrypted.write({ revision: 1 }, passphrase);
    const envelope = await store.get(vaultKey);
    const lineage = (envelope as { readonly lineage: string }).lineage;
    const commitKey = `${vaultKey}:commit:${lineage}`;
    const staleCommitState = await freshness.get(commitKey);
    await encrypted.write({ revision: 2 }, passphrase);

    // A fresh browser session: one read, no writes.
    const afterRestart = createEncryptedStore(store, vaultKey, freshness, createMemoryStore());
    expect(await afterRestart.read(passphrase)).toEqual({ revision: 2 });

    await store.set(vaultKey, envelope as Json);
    await freshness.set(commitKey, staleCommitState as Json);

    await expect(afterRestart.read(passphrase)).rejects.toThrow(
      "Encrypted store rollback detected",
    );
  });

  // Promotion writes the shadow before the durable record. Interrupted between
  // the two, the durable record still names the new commit as pending — the
  // legitimate interrupted-write shape — but the shadow no longer vouches for
  // the old commit, so restoring the old pair fails the second authority.
  test("promotes the shadow first so an interrupted promotion cannot be rolled back", async () => {
    const store = createMemoryStore();
    const durable = createMemoryStore();
    const session = createMemoryStore();
    let promotions = 0;
    const freshness = {
      get: durable.get.bind(durable),
      remove: durable.remove.bind(durable),
      async set(key: string, value: Json) {
        if (isRecord(value) && value["pending"] === null) {
          promotions += 1;
          if (promotions === 2) {
            throw new Error("interrupted");
          }
        }
        await durable.set(key, value);
      },
    };
    const encrypted = createEncryptedStore(store, vaultKey, freshness, session);

    await encrypted.write({ revision: 1 }, passphrase);
    const envelope = await store.get(vaultKey);
    const lineage = (envelope as { readonly lineage: string }).lineage;
    const commitKey = `${vaultKey}:commit:${lineage}`;
    const staleCommitState = await durable.get(commitKey);
    await expect(encrypted.write({ revision: 2 }, passphrase)).rejects.toThrow("interrupted");

    const shadow = (await session.get(commitKey)) as { readonly pending: string | null };
    expect(shadow.pending).toBeNull();

    await store.set(vaultKey, envelope as Json);
    await durable.set(commitKey, staleCommitState as Json);

    await expect(encrypted.read(passphrase)).rejects.toThrow("Encrypted store rollback detected");
  });

  // A version-2 envelope carries no lineage, so a downgrade to one cannot be
  // caught per lineage. Once this session has seen a committed lineage current
  // for the store, a legacy envelope with its durable marker deleted is a
  // rollback, not a vault that was never migrated.
  test("refuses a version-2 envelope restored after a committed one was read this session", async () => {
    const store = createMemoryStore();
    const freshness = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey, freshness, createMemoryStore());

    await encrypted.write({ revision: 1 }, passphrase);
    expect(await encrypted.read(passphrase)).toEqual({ revision: 1 });

    await store.set(vaultKey, legacyEnvelopeShape());
    await freshness.remove(`${vaultKey}:legacy`);

    await expect(encrypted.read(passphrase)).rejects.toThrow("Encrypted store rollback detected");
  });

  // The marker is per session like the rest of the shadow: a fresh session
  // that has never seen a committed lineage still reads a legacy envelope
  // through the durable authority alone.
  test("still admits a legacy envelope in a session that has seen no committed lineage", async () => {
    const store = createMemoryStore();
    const freshness = createMemoryStore();
    await store.set(vaultKey, legacyEnvelopeShape());
    const encrypted = createEncryptedStore(store, vaultKey, freshness, createMemoryStore());

    // Refused only at decryption, which is where an unmigrated vault with the
    // wrong passphrase would fail too — never as a rollback.
    await expect(encrypted.read(passphrase)).rejects.not.toThrow(
      "Encrypted store rollback detected",
    );
  });

  test("refuses a shadow record that is not a commit state", async () => {
    const store = createMemoryStore();
    const freshness = createMemoryStore();
    const session = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey, freshness, session);

    await encrypted.write({ revision: 1 }, passphrase);
    const lineage = (await store.get(vaultKey)) as { readonly lineage: string };
    await session.set(`${vaultKey}:commit:${lineage.lineage}`, { tampered: true });

    await expect(encrypted.read(passphrase)).rejects.toThrow(
      "Invalid encrypted store commit state",
    );
  });
});
