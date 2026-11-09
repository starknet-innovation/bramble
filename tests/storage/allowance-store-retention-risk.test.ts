/**
 * Sherlock 183: a full scope used to evict its oldest-written record, which is
 * the stale, forgotten approval the manager exists to surface, and one signed
 * multicall of 50 one-wei approvals cleared a scope. Eviction now drops the
 * smallest allowances first, and among equal ones the oldest.
 *
 * Sherlock 192: a revoke is recorded when submitted, so the grant is kept,
 * marked as revoking, until a chain reading of zero confirms it.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import {
  ALLOWANCE_LIMITS,
  type AllowanceInput,
  type AllowanceStore,
  createAllowanceStore,
  memoryAllowanceStore,
} from "@bramble/transactions/allowance-store";

const ACCOUNT = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const UNLIMITED = ((1n << 128n) - 1n).toString();
const CAP = ALLOWANCE_LIMITS.entriesPerScope;

const spenderAt = (index: number): string => `0x${(index + 1).toString(16)}`;
const grant = (index: number, amount: string): AllowanceInput => ({
  accountId: ACCOUNT,
  amount,
  networkId: "SN_MAIN",
  spender: spenderAt(index),
  token: TOKEN,
});
const spenders = async (store: AllowanceStore): Promise<readonly string[]> =>
  (await store.list()).map((entry) => entry.spender);

const cases: readonly (readonly [string, () => AllowanceStore])[] = [
  ["createAllowanceStore", () => createAllowanceStore({ store: createMemoryStore() })],
  ["memoryAllowanceStore", memoryAllowanceStore],
];

for (const [name, make] of cases) {
  describe(`${name} eviction by size`, () => {
    test("an old unlimited grant outlives later smaller ones", async () => {
      const store = make();
      await store.record(grant(0, UNLIMITED));
      for (let index = 1; index <= CAP; index += 1) {
        await store.record(grant(index, "1000"));
      }

      const kept = await spenders(store);
      expect(kept).toHaveLength(CAP);
      expect(kept).toContain(spenderAt(0));
      // The oldest of the equal, smaller grants is the one that went.
      expect(kept).not.toContain(spenderAt(1));
    });

    test("a batch of one-wei approvals does not clear a full scope", async () => {
      const store = make();
      for (let index = 0; index < CAP; index += 1) {
        await store.record(grant(index, "1000"));
      }
      for (let index = CAP; index < CAP * 2; index += 1) {
        await store.record(grant(index, "1"));
      }

      const kept = await spenders(store);
      expect(kept).toHaveLength(CAP);
      expect(kept.every((spender) => BigInt(spender) <= BigInt(spenderAt(CAP - 1)))).toBe(true);
    });

    test("a lower bound ranks at the figure it proves", async () => {
      const store = make();
      await store.record({ ...grant(0, "5000"), lowerBound: true });
      for (let index = 1; index <= CAP; index += 1) {
        await store.record(grant(index, "1000"));
      }
      expect(await spenders(store)).toContain(spenderAt(0));
    });
  });

  describe(`${name} pending revokes`, () => {
    test("a zero recorded over a grant keeps the grant, marked as revoking", async () => {
      const store = make();
      await store.record(grant(0, UNLIMITED));
      await store.record(grant(0, "0"));
      expect(await store.list()).toMatchObject([{ amount: UNLIMITED, revoking: true }]);
    });

    test("a pending revoke of an unlimited grant is not the first to be evicted", async () => {
      const store = make();
      await store.record(grant(0, UNLIMITED));
      await store.record(grant(0, "0"));
      for (let index = 1; index <= CAP; index += 1) {
        await store.record(grant(index, "1000"));
      }
      expect(await spenders(store)).toContain(spenderAt(0));
    });

    test("a new grant on the pair clears the revoking mark", async () => {
      const store = make();
      await store.record(grant(0, UNLIMITED));
      await store.record(grant(0, "0"));
      await store.record(grant(0, "7"));
      const [entry] = await store.list();
      expect(entry).toMatchObject({ amount: "7" });
      expect(entry?.revoking).toBeUndefined();
    });

    test("a zero for a pair the log never held writes nothing", async () => {
      const store = make();
      await store.record(grant(0, "0"));
      expect(await store.list()).toEqual([]);
    });

    test("settling drops pending revokes and zero bounds the chain reads as zero", async () => {
      const store = make();
      await store.record(grant(0, UNLIMITED));
      await store.record(grant(0, "0"));
      await store.applyDelta({ direction: "subtract", input: grant(1, "5") });
      await store.record(grant(2, UNLIMITED));
      await store.record(grant(2, "0"));
      const ids = (await store.list()).map((entry) => entry.id);

      await store.settleRevocations([
        { amount: "0", id: ids[2] ?? "" },
        { amount: "0", id: ids[1] ?? "" },
        { amount: "42", id: ids[0] ?? "" },
      ]);

      // The non-zero reading neither drops nor rewrites its pending revoke.
      expect(await store.list()).toMatchObject([
        { amount: UNLIMITED, revoking: true, spender: spenderAt(2) },
      ]);
    });

    test("settling leaves a record holding a figure alone", async () => {
      // The chain can lag a grant this wallet has submitted but the network
      // has not mined, so a zero reading never removes a plain figure.
      const store = make();
      await store.record(grant(0, "1000"));
      const [entry] = await store.list();
      await store.settleRevocations([{ amount: "0", id: entry?.id ?? "" }]);
      expect(await store.list()).toMatchObject([{ amount: "1000" }]);
    });
  });
}
