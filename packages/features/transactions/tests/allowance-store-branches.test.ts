/**
 * Coverage for the allowance store's dedup / not-found / no-op mutator
 * branches: a record whose token or spender is not a felt is dropped by
 * `toRecord` (both persistent and in-memory stores), a zero-amount record is a
 * no-op removal, upsert replaces an existing entry, and remove of an absent id
 * leaves the log untouched.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@mc-wallet/store/kv";
import {
  createAllowanceStore,
  memoryAllowanceStore,
} from "@mc-wallet/transactions/allowance-store";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const SPENDER = "0x05";

const input = (over: Partial<Record<string, string>> = {}) => ({
  accountId: ACCOUNT_ID,
  amount: "1000",
  networkId: "SN_MAIN" as const,
  spender: SPENDER,
  token: TOKEN,
  ...over,
});

describe("createAllowanceStore no-op branches", () => {
  test("drops a record whose token is not a felt (toRecord returns null)", async () => {
    const store = createAllowanceStore({ store: createMemoryStore() });
    await store.record(input({ token: "not-a-felt" }));
    expect(await store.list()).toEqual([]);
  });

  test("drops a record whose spender is not a felt", async () => {
    const store = createAllowanceStore({ store: createMemoryStore() });
    await store.record(input({ spender: "" }));
    expect(await store.list()).toEqual([]);
  });

  test("remove of an absent id is a no-op", async () => {
    const store = createAllowanceStore({ store: createMemoryStore() });
    await store.record(input());
    await store.remove(`${ACCOUNT_ID}:0xdead:0xbeef`);
    expect(await store.list()).toHaveLength(1);
  });
});

describe("memoryAllowanceStore no-op branches", () => {
  test("drops an invalid record and keeps the log empty", async () => {
    const store = memoryAllowanceStore();
    await store.record(input({ token: "xyz" }));
    expect(await store.list()).toEqual([]);
  });

  test("upserts the same spender/token instead of duplicating", async () => {
    const store = memoryAllowanceStore();
    await store.record(input({ amount: "1000" }));
    await store.record(input({ amount: "2000" }));
    const entries = await store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.amount).toBe("2000");
  });

  test("treats a zero amount as a removal (no push) and removes any prior entry", async () => {
    const store = memoryAllowanceStore();
    await store.record(input({ amount: "1000" }));
    await store.record(input({ amount: "0" }));
    expect(await store.list()).toEqual([]);
  });

  test("a zero-amount record with no prior entry stays empty", async () => {
    const store = memoryAllowanceStore();
    await store.record(input({ amount: "0" }));
    expect(await store.list()).toEqual([]);
  });

  test("remove clears the matching entry and no-ops on an absent id", async () => {
    const store = memoryAllowanceStore();
    await store.record(input());
    const id = (await store.list())[0]?.id ?? "";
    await store.remove("SN_MAIN:0xabc:0xdef");
    expect(await store.list()).toHaveLength(1);
    await store.remove(id);
    expect(await store.list()).toEqual([]);
  });
});
