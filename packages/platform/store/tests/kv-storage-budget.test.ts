/**
 * Only the vault envelope keys get the larger at-rest storage budget
 * (Sherlock 261). The envelope's base64 ciphertext can outgrow the provider
 * budget its plaintext was held to, but every other key keeps the provider
 * budget, so no other value can grow toward the browser's shared quota.
 */
import { describe, expect, test } from "bun:test";
import { JSON_BUDGETS } from "@bramble/core/json";
import { createMemoryStore, STRK20_PROOF_KEY_PREFIX, storageBudgetFor } from "@bramble/store/kv";

const VAULT_STORE_KEY = "bramble:vault";
const VAULT_MIGRATION_STORE_KEY = "bramble:vault-migration";

// Longer than any provider-budget string, within the at-rest budget.
const ciphertextSized = "A".repeat(JSON_BUDGETS.provider.maxStringLength + 1);

describe("storageBudgetFor", () => {
  test("gives the vault envelope and its staging copy the at-rest budget", () => {
    expect(storageBudgetFor(VAULT_STORE_KEY)).toBe(JSON_BUDGETS.storage);
    expect(storageBudgetFor(VAULT_MIGRATION_STORE_KEY)).toBe(JSON_BUDGETS.storage);
  });

  test("gives only proof-bytes keys the one-proof budget", () => {
    expect(storageBudgetFor(`${STRK20_PROOF_KEY_PREFIX}intent:sn-main:0x1:0x2`)).toBe(
      JSON_BUDGETS.strk20Proof,
    );
    // The shared multisig row and a look-alike prefix stay on the provider budget.
    for (const key of ["bramble:argent-multisig-strk20:v1", "bramble:multisig-strk20-proofs"]) {
      expect(storageBudgetFor(key)).toBe(JSON_BUDGETS.provider);
    }
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
