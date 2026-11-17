/**
 * The store package gives the larger at-rest budget only to the keys that
 * hold an encrypted vault envelope (Sherlock 261). It names them itself,
 * because vault store keys may only be wired in the vault and background
 * modules, so this pins its list to the vault's own constants.
 */
import { expect, test } from "bun:test";
import { ENCRYPTED_ENVELOPE_KEYS } from "@bramble/store/kv";
import { VAULT_MIGRATION_STORE_KEY, VAULT_STORE_KEY } from "@bramble/vault/store-migration";

test("the store's envelope keys are exactly the vault's and its staging copy's", () => {
  expect([...ENCRYPTED_ENVELOPE_KEYS].sort()).toEqual(
    [VAULT_MIGRATION_STORE_KEY, VAULT_STORE_KEY].sort(),
  );
});
