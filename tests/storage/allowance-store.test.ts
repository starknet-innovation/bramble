/**
 * Allowance store checks: deterministic ids, canonicalization, upsert by
 * spender/token, and zero-amount removal on revoke.
 */
import { describe, expect, test } from "bun:test";
import {
  ALLOWANCE_STORE_KEY,
  allowanceId,
  allowanceTarget,
  createAllowanceStore,
  isAllowanceRecord,
  memoryAllowanceStore,
} from "../../src/storage/allowance-store";
import { createMemoryStore } from "../../src/storage/kv";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const SPENDER = "0x05";

const input = (amount: string) => ({
  accountId: ACCOUNT_ID,
  amount,
  networkId: "SN_MAIN" as const,
  spender: SPENDER,
  token: TOKEN,
});

describe("allowance store", () => {
  test("derives a deterministic id from account, canonical token, and spender", () => {
    expect(allowanceId(input("1000"))).toBe(`${ACCOUNT_ID}:0x${BigInt(TOKEN).toString(16)}:0x5`);
  });

  test("rejects an account id whose embedded network contradicts the record", () => {
    const candidate = {
      ...input("1000"),
      id: `${ACCOUNT_ID}:${TOKEN}:0x5`,
      networkId: "SN_SEPOLIA",
    };
    expect(isAllowanceRecord(candidate)).toBe(false);
  });

  test("records, canonicalizes spender, and lists newest first", async () => {
    const store = createAllowanceStore({ store: createMemoryStore() });
    await store.record(input("1000"));
    await store.record({ ...input("50"), spender: "0x0a" });

    const entries = await store.list();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.spender).toBe("0xa");
    expect(entries[1]?.spender).toBe("0x5");
    expect(entries.every(isAllowanceRecord)).toBe(true);
  });

  test("upserts the same spender/token instead of duplicating", async () => {
    const store = memoryAllowanceStore();
    await store.record(input("1000"));
    await store.record(input("2000"));

    const entries = await store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.amount).toBe("2000");
  });

  test("treats a zero amount as a revoke and removes the entry", async () => {
    const store = createAllowanceStore({ store: createMemoryStore() });
    await store.record(input("1000"));
    await store.record(input("0"));

    expect(await store.list()).toEqual([]);
  });

  test("recovers the token and spender an id targets for the owning account", () => {
    const id = allowanceId(input("1000")) ?? "";
    expect(allowanceTarget(id, ACCOUNT_ID)).toEqual({
      spender: "0x5",
      token: `0x${BigInt(TOKEN).toString(16)}`,
    });
  });

  test("rejects an id that belongs to another account or is malformed", () => {
    const id = allowanceId(input("1000")) ?? "";
    expect(allowanceTarget(id, "SN_MAIN:0x9999")).toBeNull();
    expect(allowanceTarget(`${ACCOUNT_ID}:0x1`, ACCOUNT_ID)).toBeNull();
    expect(allowanceTarget(`${ACCOUNT_ID}:0x0:0x5`, ACCOUNT_ID)).toBeNull();
  });

  test("removes by id and ignores malformed stored data", async () => {
    const kv = createMemoryStore();
    const store = createAllowanceStore({ store: kv });
    await store.record(input("1000"));
    const id = (await store.list())[0]?.id ?? "";
    await store.remove(id);
    expect(await store.list()).toEqual([]);

    await kv.set(ALLOWANCE_STORE_KEY, [{ bogus: true }]);
    expect(await store.list()).toEqual([]);
  });
});
