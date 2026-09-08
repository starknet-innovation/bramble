/** Lock invalidates asynchronous key resolutions, including their fingerprint step. */
import { expect, spyOn, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import { assertJsonValue, createMemoryStore } from "@bramble/store/kv";
import {
  createEncryptedStore,
  type EncryptedEnvelope,
  isEncryptedEnvelope,
} from "@bramble/vault/encrypted-store";

for (const boundary of ["fingerprint", "derivation"] as const) {
  test(`does not retain a key when cleared during ${boundary}`, async () => {
    const encrypted = createEncryptedStore(createMemoryStore(), "bramble:vault");
    const passphrase = "correct horse battery staple";
    await encrypted.write({ synthetic: true }, passphrase);
    encrypted.clearKeys();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
    const originalDerive = crypto.subtle.deriveKey.bind(crypto.subtle);
    let paused = false;
    const pause = async (): Promise<void> => {
      if (paused) return;
      paused = true;
      started.resolve();
      await release.promise;
    };
    const digest = spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
      if (boundary === "fingerprint") await pause();
      return originalDigest(...args);
    });
    const derive = spyOn(crypto.subtle, "deriveKey").mockImplementation(async (...args) => {
      if (boundary === "derivation") await pause();
      return originalDerive(...args);
    });
    try {
      const pending = encrypted.read(passphrase);
      await started.promise;
      encrypted.clearKeys();
      release.resolve();
      await expect(pending).resolves.toEqual({ synthetic: true });
      // Stale work may finish, but its key must not survive in the cleared cache.
      await encrypted.read(passphrase);
      expect(derive).toHaveBeenCalledTimes(2);
      // A fresh resolution still caches normally.
      await encrypted.read(passphrase);
      expect(derive).toHaveBeenCalledTimes(2);
    } finally {
      release.resolve();
      digest.mockRestore();
      derive.mockRestore();
    }
  });
}

test("does not evict a fresh key when a cleared resolution settles into a full cache", async () => {
  const key = "bramble:vault";
  const store = createMemoryStore();
  const encrypted = createEncryptedStore(store, key);
  const passphrase = "correct horse battery staple";
  await encrypted.write({ old: true }, passphrase);
  encrypted.clearKeys();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const originalDerive = crypto.subtle.deriveKey.bind(crypto.subtle);
  let paused = false;
  const derive = spyOn(crypto.subtle, "deriveKey").mockImplementation(async (...args) => {
    if (!paused) {
      paused = true;
      started.resolve();
      await release.promise;
    }
    return originalDerive(...args);
  });
  try {
    const pending = encrypted.read(passphrase);
    await started.promise;
    encrypted.clearKeys();
    let firstFreshEnvelope: Extract<EncryptedEnvelope, { readonly version: 3 }> | undefined;
    let firstFreshCommit: Json | undefined;
    for (let index = 0; index < 8; index += 1) {
      await encrypted.write({ index }, passphrase);
      if (index === 0) {
        const current = await store.get(key);
        if (!isEncryptedEnvelope(current) || current.version !== 3) {
          throw new Error("missing fresh encrypted envelope");
        }
        firstFreshEnvelope = current;
        const commit = await store.get(`${key}:commit:${current.lineage}`);
        assertJsonValue(commit);
        firstFreshCommit = commit;
      }
    }
    if (!firstFreshEnvelope || !firstFreshCommit) throw new Error("missing fresh cache entry");
    release.resolve();
    await expect(pending).resolves.toEqual({ old: true });
    await store.set(key, firstFreshEnvelope);
    await store.set(`${key}:commit:${firstFreshEnvelope.lineage}`, firstFreshCommit);
    await expect(encrypted.read(passphrase)).resolves.toEqual({ index: 0 });
    expect(derive).toHaveBeenCalledTimes(9);
  } finally {
    release.resolve();
    derive.mockRestore();
  }
});
