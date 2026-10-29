/**
 * `recordIfAbsent`: the insert-if-absent the sponsored deploy records its row
 * with (#788). The relay's hash is its claim, so the row is written only when
 * no row of any account carries it, and the check and the write are one
 * serialized mutation: two overlapping recordings of one hash leave exactly one
 * row, and a row another path wrote (with its fee) is never replaced.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import {
  type ActivityLog,
  createActivityLog,
  memoryActivityLog,
} from "@bramble/transactions/activity";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const OTHER_ACCOUNT_ID =
  "SN_MAIN:0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const deployRow = (accountId: string, hash = "0x5ab") => ({
  accountId,
  feePayer: "sponsor" as const,
  hash,
  kind: "deploy" as const,
  networkId: "SN_MAIN" as const,
  origin: "wallet" as const,
  summary: "Deploy account contract",
});

// A store whose reads answer late, so two mutations that are not serialized
// would both read the log before either writes it.
const slowStore = (): KeyValueStore => {
  const store = createMemoryStore();
  return {
    ...store,
    get: async (key) => {
      const value = await store.get(key);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return value;
    },
  };
};

const logs: readonly [string, () => ActivityLog][] = [
  ["the persistent log", () => createActivityLog({ now: () => 1, store: slowStore() })],
  ["the memory log", () => memoryActivityLog(() => 1)],
];

for (const [name, makeLog] of logs) {
  describe(`${name} recordIfAbsent`, () => {
    test("writes a fresh hash once", async () => {
      const log = makeLog();
      expect(await log.recordIfAbsent(deployRow(ACCOUNT_ID))).toBe(true);
      expect(await log.list()).toMatchObject([{ feePayer: "sponsor", hash: "0x5ab" }]);
    });

    test("two overlapping recordings of one hash leave exactly one row", async () => {
      for (const other of [ACCOUNT_ID, OTHER_ACCOUNT_ID]) {
        const log = makeLog();
        const answers = await Promise.all([
          log.recordIfAbsent(deployRow(ACCOUNT_ID)),
          log.recordIfAbsent(deployRow(other, "0x05ab")),
        ]);
        expect([...answers].sort()).toEqual([false, true]);
        const rows = await log.list();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.accountId).toBe(ACCOUNT_ID);
      }
    });

    test("leaves a row another path wrote, with its fee, untouched", async () => {
      const log = makeLog();
      const scope = { accountId: OTHER_ACCOUNT_ID, networkId: "SN_MAIN" } as const;
      await log.record({ ...scope, hash: "0x5ab", kind: "transfer", summary: "Sent 1 STRK" });
      await log.updateStatuses(
        { "0x5ab": { feePaid: { amount: "0x10", unit: "FRI" }, status: "accepted" } },
        scope,
      );
      expect(await log.recordIfAbsent(deployRow(ACCOUNT_ID))).toBe(false);
      expect(await log.list()).toMatchObject([
        { accountId: OTHER_ACCOUNT_ID, feePaid: { amount: "0x10", unit: "FRI" }, kind: "transfer" },
      ]);
    });
  });
}

describe("recordIfAbsent failures", () => {
  test("rejects, writing nothing, when the log cannot be read", async () => {
    const store: KeyValueStore = {
      ...createMemoryStore(),
      get: async () => {
        throw new Error("storage unavailable");
      },
    };
    const log = createActivityLog({ store });
    await expect(log.recordIfAbsent(deployRow(ACCOUNT_ID))).rejects.toThrow("storage unavailable");
  });
});
