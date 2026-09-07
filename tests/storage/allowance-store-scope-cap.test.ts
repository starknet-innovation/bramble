/**
 * MCW-V09-125: the allowance retention cap must be scoped per account and
 * network. A global cap let approvals on one account evict another account's
 * records, after which the allowance manager could neither show nor revoke them.
 *
 * Two properties are pinned here. The per-scope cap, which stops one account
 * filling its own quota from touching another's; and the TOTAL cap, which still
 * has to evict something once the whole log is full — and must take it from the
 * scopes that filled the log rather than from whichever scope happens to hold
 * the oldest write, because write age is not evidence that an allowance is dead.
 * Scoping is checked as an enforced property (a record whose `networkId`
 * disagrees with its account id is refused) rather than an artefact of how
 * account ids are spelled.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import {
  ALLOWANCE_LIMITS,
  type AllowanceInput,
  type AllowanceStore,
  allowanceScope,
  createAllowanceStore,
  isAllowanceRecord,
  memoryAllowanceStore,
} from "@bramble/transactions/allowance-store";

const MAIN_ACCOUNT = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const OTHER_MAIN_ACCOUNT =
  "SN_MAIN:0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const SEPOLIA_ACCOUNT =
  "SN_SEPOLIA:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const CANONICAL_TOKEN = `0x${BigInt(TOKEN).toString(16)}`;

/** The store's own per-account-and-network cap, not a local copy of it. */
const CAP = ALLOWANCE_LIMITS.entriesPerScope;

const spenderAt = (index: number): string => `0x${(index + 1).toString(16)}`;

const networkOf = (accountId: string): "SN_MAIN" | "SN_SEPOLIA" =>
  accountId.startsWith("SN_SEPOLIA:") ? "SN_SEPOLIA" : "SN_MAIN";

const input = (accountId: string, index: number): AllowanceInput => ({
  accountId,
  amount: "1000",
  networkId: networkOf(accountId),
  spender: spenderAt(index),
  token: TOKEN,
});

const fill = async (store: AllowanceStore, accountId: string, count: number): Promise<void> => {
  for (let index = 0; index < count; index += 1) {
    await store.record(input(accountId, index));
  }
};

const idsFor = async (store: AllowanceStore, accountId: string): Promise<readonly string[]> =>
  (await store.list()).filter((entry) => entry.accountId === accountId).map((entry) => entry.id);

const cases: readonly (readonly [string, () => AllowanceStore])[] = [
  ["createAllowanceStore", () => createAllowanceStore({ store: createMemoryStore() })],
  ["memoryAllowanceStore", memoryAllowanceStore],
];

for (const [name, make] of cases) {
  describe(`${name} retention scope`, () => {
    test("keeps another account's allowances when one account fills the cap", async () => {
      const store = make();
      await store.record(input(OTHER_MAIN_ACCOUNT, 0));
      await fill(store, MAIN_ACCOUNT, CAP + 5);

      expect(await idsFor(store, OTHER_MAIN_ACCOUNT)).toHaveLength(1);
      expect(await idsFor(store, MAIN_ACCOUNT)).toHaveLength(CAP);
    });

    test("keeps another network's allowances when one network fills the cap", async () => {
      const store = make();
      await store.record(input(SEPOLIA_ACCOUNT, 0));
      await fill(store, MAIN_ACCOUNT, CAP + 5);

      const sepolia = await idsFor(store, SEPOLIA_ACCOUNT);
      expect(sepolia).toHaveLength(1);
      expect(sepolia[0]).toContain("SN_SEPOLIA");
    });

    test("evicts only the oldest records of the writing scope", async () => {
      const store = make();
      await fill(store, MAIN_ACCOUNT, CAP + 1);

      const ids = await idsFor(store, MAIN_ACCOUNT);
      expect(ids).toHaveLength(CAP);
      expect(ids).not.toContain(`${MAIN_ACCOUNT}:${CANONICAL_TOKEN}:${spenderAt(0)}`);
      expect(ids).toContain(`${MAIN_ACCOUNT}:${CANONICAL_TOKEN}:${spenderAt(CAP)}`);
    });

    test("still upserts by id and removes on a zero amount", async () => {
      const store = make();
      await store.record(input(MAIN_ACCOUNT, 0));
      await store.record({ ...input(MAIN_ACCOUNT, 0), amount: "2000" });
      expect(await store.list()).toHaveLength(1);
      expect((await store.list())[0]?.amount).toBe("2000");

      await store.record({ ...input(MAIN_ACCOUNT, 0), amount: "0" });
      expect(await store.list()).toEqual([]);
    });
  });
}

// Enough distinct accounts to saturate the total bound at the per-scope cap, so
// the next write has to evict something that belongs to somebody.
const SATURATING_ACCOUNTS = Array.from(
  { length: Math.ceil(ALLOWANCE_LIMITS.entriesTotal / CAP) },
  (_unused, index) =>
    `SN_MAIN:0x${(index + 3).toString(16)}234567890abcdef1234567890abcdef1234567890abcdef123456789`,
);
const LATE_ACCOUNT = "SN_MAIN:0x9234567890abcdef1234567890abcdef1234567890abcdef123456789";

for (const [name, make] of cases) {
  describe(`${name} total-cap fairness`, () => {
    test("a newly busy account cannot empty an idle account's allowance list", async () => {
      const store = make();
      for (const account of SATURATING_ACCOUNTS) {
        await fill(store, account, CAP);
      }
      expect(await store.list()).toHaveLength(ALLOWANCE_LIMITS.entriesTotal);

      // The log is full, so every one of these writes evicts a record. Under a
      // globally-oldest eviction they all come out of the first account, which
      // then reports "no allowances" while still holding live approvals.
      await fill(store, LATE_ACCOUNT, CAP);

      expect((await store.list()).length).toBeLessThanOrEqual(ALLOWANCE_LIMITS.entriesTotal);
      const shares = await Promise.all(
        [...SATURATING_ACCOUNTS, LATE_ACCOUNT].map(
          async (account) => (await idsFor(store, account)).length,
        ),
      );
      expect(Math.min(...shares)).toBeGreaterThan(0);
      // Fair, not merely non-empty: every scope ends within a rounding error of
      // an equal share instead of one being levelled to make room for the rest.
      expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(CAP / 10);
    });

    test("evicting for the total cap still takes a scope's oldest record first", async () => {
      const store = make();
      for (const account of SATURATING_ACCOUNTS) {
        await fill(store, account, CAP);
      }
      await fill(store, LATE_ACCOUNT, CAP);

      for (const account of SATURATING_ACCOUNTS) {
        const ids = await idsFor(store, account);
        expect(ids).not.toContain(`${account}:${CANONICAL_TOKEN}:${spenderAt(0)}`);
        expect(ids).toContain(`${account}:${CANONICAL_TOKEN}:${spenderAt(CAP - 1)}`);
      }
    });
  });
}

describe("allowance scope is per account and network by construction", () => {
  test("the same address on two networks is two scopes and two ids", async () => {
    const store = memoryAllowanceStore();
    await store.record(input(MAIN_ACCOUNT, 0));
    await store.record(input(SEPOLIA_ACCOUNT, 0));

    const entries = await store.list();
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
    expect(allowanceScope(input(MAIN_ACCOUNT, 0))).not.toBe(
      allowanceScope(input(SEPOLIA_ACCOUNT, 0)),
    );
  });

  test("a record whose network disagrees with its account id is refused", () => {
    const record = {
      accountId: MAIN_ACCOUNT,
      amount: "1000",
      id: `${MAIN_ACCOUNT}:${CANONICAL_TOKEN}:${spenderAt(0)}`,
      networkId: "SN_SEPOLIA",
      spender: spenderAt(0),
      token: CANONICAL_TOKEN,
    };
    expect(isAllowanceRecord(record)).toBe(false);
    expect(isAllowanceRecord({ ...record, networkId: "SN_MAIN" })).toBe(true);
  });
});
