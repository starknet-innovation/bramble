/**
 * Only the vault envelope keys get the larger at-rest storage budget
 * (Sherlock 261). The envelope's base64 ciphertext can outgrow the provider
 * budget its plaintext was held to, but every other key keeps the provider
 * budget, so no other value can grow toward the browser's shared quota.
 */
import { describe, expect, test } from "bun:test";
import { JSON_BUDGETS } from "@bramble/core/json";
import {
  createMemoryStore,
  isQsbJournalStorageKey,
  QSB_JOURNAL_KEY_PREFIX,
  storageBudgetFor,
} from "@bramble/store/kv";

const VAULT_STORE_KEY = "bramble:vault";
const VAULT_MIGRATION_STORE_KEY = "bramble:vault-migration";

// Longer than any provider-budget string, within the at-rest budget.
const ciphertextSized = "A".repeat(JSON_BUDGETS.provider.maxStringLength + 1);

describe("storageBudgetFor", () => {
  test("gives the vault envelope and its staging copy the at-rest budget", () => {
    expect(storageBudgetFor(VAULT_STORE_KEY)).toBe(JSON_BUDGETS.storage);
    expect(storageBudgetFor(VAULT_MIGRATION_STORE_KEY)).toBe(JSON_BUDGETS.storage);
  });

  test("keeps every other key, the vault's own records included, on the provider budget", () => {
    for (const key of [
      "bramble:preferences",
      "bramble:activity",
      `${VAULT_STORE_KEY}:commit:00000000000000000000000000000000`,
      `${VAULT_STORE_KEY}:legacy`,
    ]) {
      expect(storageBudgetFor(key)).toBe(JSON_BUDGETS.provider);
    }
  });
});

describe("QSB journal keys", () => {
  const journalKey = `bramble:qsb-journal:${"5e".repeat(32)}`;

  test("get the capped journal budget, and their records the provider budget", () => {
    expect(isQsbJournalStorageKey(journalKey)).toBe(true);
    expect(storageBudgetFor(journalKey)).toBe(JSON_BUDGETS.qsbJournalStorage);
    for (const key of [
      `${journalKey}:commit:${"0".repeat(32)}`,
      `${journalKey}:legacy`,
      `${QSB_JOURNAL_KEY_PREFIX}${"5E".repeat(32)}`,
      `${QSB_JOURNAL_KEY_PREFIX}${"5e".repeat(31)}`,
    ]) {
      expect(isQsbJournalStorageKey(key)).toBe(false);
    }
    expect(storageBudgetFor(`${journalKey}:commit:${"0".repeat(32)}`)).toBe(JSON_BUDGETS.provider);
  });

  test("admit a full journal's envelope and nothing much larger", async () => {
    const store = createMemoryStore();
    const fits = "A".repeat(JSON_BUDGETS.qsbJournalStorage.maxStringLength);
    await store.set(journalKey, { data: fits });
    await expect(store.set(journalKey, { data: `${fits}A` })).rejects.toThrow("Invalid JSON value");
    await expect(store.set("bramble:preferences", { data: fits })).rejects.toThrow(
      "Invalid JSON value",
    );
  });
});

describe("memory store writes", () => {
  test("admit a ciphertext-sized value only under a vault envelope key", async () => {
    const store = createMemoryStore();
    await store.set(VAULT_STORE_KEY, { ciphertext: ciphertextSized });
    expect(await store.get(VAULT_STORE_KEY)).toEqual({ ciphertext: ciphertextSized });
    await expect(store.set("bramble:preferences", { blob: ciphertextSized })).rejects.toThrow(
      "Invalid JSON value",
    );
  });
});
