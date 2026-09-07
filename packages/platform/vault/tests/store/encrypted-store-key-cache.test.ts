/** Lock invalidates asynchronous key resolutions, including their fingerprint step. */
import { expect, spyOn, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";

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
