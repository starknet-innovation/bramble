/**
 * MCW-V09-125 (follow-up): scoping the allowance cap per account and network
 * must not drop the log's total bound. Every write goes through
 * `assertJsonValue` in `kv.ts`, and `recordApproveAllowances` swallows a
 * rejected write — so a log that outgrows the bounded-JSON budget stops tracking
 * newly granted allowances silently, which is the same harm as evicting them.
 */
import { describe, expect, test } from "bun:test";
import { isJson } from "@bramble/core/json";
import { createMemoryStore } from "@bramble/store/kv";
import {
  ALLOWANCE_LIMITS,
  type AllowanceInput,
  type AllowanceRecord,
  allowanceId,
  createAllowanceStore,
  memoryAllowanceStore,
} from "@bramble/transactions/allowance-store";

// Worst-case field sizes the validators accept: the longest network id, a
// full-width account address, full-width token and spender felts, and the
// 78-digit maximum amount. Anything shorter costs the JSON budget less.
const NETWORK_ID = "SN_SEPOLIA";
const MAX_AMOUNT = "9".repeat(78);
const wideFelt = (offset: number): string =>
  `0x${(BigInt(`0x${"7".repeat(63)}`) + BigInt(offset)).toString(16)}`;
const accountAt = (index: number): string => `${NETWORK_ID}:${wideFelt(index)}`;

const input = (accountIndex: number, index: number): AllowanceInput => ({
  accountId: accountAt(accountIndex),
  amount: MAX_AMOUNT,
  networkId: NETWORK_ID,
  spender: wideFelt(1_000 + index),
  token: wideFelt(500_000 + index),
});

const asRecord = (entry: AllowanceInput): AllowanceRecord => {
  const id = allowanceId(entry);
  if (id === null) {
    throw new Error("fixture is not a valid allowance");
  }
  return { ...entry, id };
};

describe("allowance log total bound", () => {
  test("a full log stays inside the storage boundary's JSON budget", () => {
    const full = Array.from({ length: ALLOWANCE_LIMITS.entriesTotal }, (_, index) =>
      asRecord(input(index % 8, index)),
    );

    expect(isJson(full)).toBe(true);
  });

  test("the per-scope cap leaves room for several coexisting scopes", () => {
    expect(ALLOWANCE_LIMITS.entriesPerScope * 4).toBeLessThanOrEqual(ALLOWANCE_LIMITS.entriesTotal);
  });

  test("record never rejects a write while several accounts saturate their scope", async () => {
    const store = createAllowanceStore({ store: createMemoryStore() });

    // Eight saturated scopes of maximum-size records overrun the budget outright
    // without a total bound, so `store.set` throws and the allowance goes
    // untracked — `record` must trim instead of ever reaching that.
    for (let account = 0; account < 8; account += 1) {
      for (let index = 0; index < ALLOWANCE_LIMITS.entriesPerScope + 5; index += 1) {
        await store.record(input(account, index));
      }
    }

    const entries = await store.list();
    expect(entries.length).toBeLessThanOrEqual(ALLOWANCE_LIMITS.entriesTotal);
    expect(isJson([...entries])).toBe(true);
  });

  test("a freshly granted allowance survives even when the total cap binds", async () => {
    const store = createAllowanceStore({ store: createMemoryStore() });

    // Six saturated scopes overrun the total bound, so from the fifth onwards
    // every write evicts something. What must never be evicted is the grant the
    // user just made: an allowance the wallet submitted and then immediately
    // forgot is one the allowance manager can neither show nor revoke.
    for (let account = 0; account < 6; account += 1) {
      for (let index = 0; index < ALLOWANCE_LIMITS.entriesPerScope; index += 1) {
        await store.record(input(account, index));
        expect((await store.list())[0]?.id).toBe(asRecord(input(account, index)).id);
      }
    }

    // And no scope is levelled to pay for the others: six scopes sharing the
    // total bound leaves each of them a share, not a survivor and five ghosts.
    for (let account = 0; account < 6; account += 1) {
      const mine = (await store.list()).filter((entry) => entry.accountId === accountAt(account));
      expect(mine.length).toBeGreaterThan(0);
    }
  });

  test("the in-memory store applies the same total bound", async () => {
    const store = memoryAllowanceStore();

    for (let account = 0; account < 6; account += 1) {
      for (let index = 0; index < ALLOWANCE_LIMITS.entriesPerScope; index += 1) {
        await store.record(input(account, index));
      }
    }

    expect((await store.list()).length).toBeLessThanOrEqual(ALLOWANCE_LIMITS.entriesTotal);
  });

  test("a log persisted over the cap by an older build is trimmed on the next write", async () => {
    const kv = createMemoryStore();
    const oversized = Array.from({ length: ALLOWANCE_LIMITS.entriesTotal + 40 }, (_, index) =>
      asRecord(input(index % 8, index)),
    );
    await kv.set("mc-wallet:allowances", oversized);

    const store = createAllowanceStore({ store: kv });
    await store.record(input(0, 90_001));

    expect((await store.list()).length).toBeLessThanOrEqual(ALLOWANCE_LIMITS.entriesTotal);
  });
});
