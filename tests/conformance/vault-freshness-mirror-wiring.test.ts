/**
 * Sherlock #138, the half that lives in the wiring rather than the store.
 *
 * `createEncryptedStore` mirrors its commit record into `storage.local` only
 * when asked, and only the primary vault may ask: the staging store's `sync`
 * record is removed after every migration, so a staging mirror would let a
 * restored `storage.local` vouch for its own staged copy. The store tests
 * prove both behaviours with the flag passed explicitly; these cases pin which
 * store production passes it to.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EXTENSION_SRC_DIR } from "../support/workspace-sources";

// Each `createEncryptedStore(...)` call in the composition root, whitespace
// collapsed, keyed by the store key constant it names.
const encryptedStoreCalls = async (): Promise<ReadonlyMap<string, string>> => {
  const source = await readFile(join(EXTENSION_SRC_DIR, "background/index.ts"), "utf8");
  const calls = new Map<string, string>();
  for (const match of source.matchAll(/createEncryptedStore\(([^)]*)\)/g)) {
    const args = (match[1] ?? "").replace(/\s+/g, " ").trim().replace(/,$/, "");
    const key = args.split(",")[1]?.trim() ?? "";
    calls.set(key, args);
  }
  return calls;
};

describe("vault freshness mirror wiring", () => {
  test("the primary vault mirrors its commit record", async () => {
    expect((await encryptedStoreCalls()).get("VAULT_STORE_KEY")).toBe(
      "store, VAULT_STORE_KEY, freshnessStore, sessionStore, true",
    );
  });

  test("the migration staging store does not", async () => {
    expect((await encryptedStoreCalls()).get("VAULT_MIGRATION_STORE_KEY")).toBe(
      "store, VAULT_MIGRATION_STORE_KEY, freshnessStore, sessionStore",
    );
  });
});
