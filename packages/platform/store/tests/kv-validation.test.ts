/** In-memory key-value boundary tests. */
import { expect, test } from "bun:test";
import { assertStorageKey, createMemoryStore } from "@mc-wallet/store/kv";

test("memory storage rejects invalid writes and snapshots valid JSON", async () => {
  const store = createMemoryStore();
  await expect(store.set("vault", { ok: true })).rejects.toThrow("Storage key must be namespaced");
  await expect(store.set("mc-wallet:test", { amount: Number.NaN })).rejects.toThrow(
    "Invalid JSON value",
  );

  const value = { nested: { ok: true } };
  await store.set("mc-wallet:test", value);
  value.nested.ok = false;
  expect(await store.get("mc-wallet:test")).toEqual({ nested: { ok: true } });
  expect(() => assertStorageKey("mc-wallet:vault")).not.toThrow();
});
