/**
 * Unlock error mapping turns a wrong passphrase into a clear message while
 * keeping a corrupt store envelope distinct.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@mc-wallet/core/errors";
import { createMemoryStore } from "@mc-wallet/store/kv";
import { createEncryptedStore, encryptJson } from "@mc-wallet/vault/encrypted-store";
import { unlockFailureError } from "../../../apps/extension/src/background/routing/unlock-errors";

const vaultKey = "mc-wallet:vault";

describe("unlockFailureError", () => {
  test("maps a decrypt/auth failure to Incorrect passphrase", async () => {
    const encrypted = createEncryptedStore(createMemoryStore(), vaultKey);
    await encrypted.write({ schemaVersion: 1 }, "correct horse battery staple");

    let caught: unknown;
    try {
      await encrypted.read("wrong horse battery staple");
    } catch (error) {
      caught = error;
    }

    const mapped = unlockFailureError(caught);
    expect(mapped).toBeInstanceOf(WalletError);
    expect(mapped.message).toBe("Incorrect passphrase");
  });

  test("keeps a corrupt store envelope distinct", async () => {
    // A wrong-scope envelope is a genuinely corrupt/mismatched store, not a
    // wrong passphrase; its distinct error must survive the mapping.
    const foreign = await encryptJson(
      { schemaVersion: 1 },
      "correct horse battery staple",
      "mc-wallet:encrypted-store:not-the-vault",
    );
    const store = createMemoryStore();
    await store.set(vaultKey, foreign);

    let caught: unknown;
    try {
      await createEncryptedStore(store, vaultKey).read("correct horse battery staple");
    } catch (error) {
      caught = error;
    }

    const mapped = unlockFailureError(caught);
    expect(mapped).toBeInstanceOf(WalletError);
    expect(mapped.message).toBe("Encrypted store commit state missing");
  });

  test("passes an unrelated error through unchanged", () => {
    const original = new Error("bad passphrase");
    expect(unlockFailureError(original)).toBe(original);
  });
});
