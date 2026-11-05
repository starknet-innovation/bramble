/**
 * The open journal stores and the journal-id drawer: one store per journal key,
 * built once through the root's factory and only for a real journal id; every
 * open store's keys dropped together on lock; and ids drawn as 32 random bytes
 * in the one grammar a journal id has.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { Json } from "@bramble/core/json";
import { createMemoryStore } from "@bramble/store/kv";
import {
  createEncryptedStore,
  type EncryptedStore,
  randomQsbJournalId,
} from "@bramble/vault/encrypted-store";
import { isQsbJournalId, MAX_QSB_ACCOUNTS } from "@bramble/vault/qsb-account";
import { createQsbJournalStores } from "@bramble/vault/qsb-journal-stores";
import { JOURNAL_ID_A, JOURNAL_ID_B } from "./qsb-fixtures";

// A factory that records each key it is asked for and each store it built.
const recordingFactory = () => {
  const keys: string[] = [];
  const cleared: string[] = [];
  const backend = createMemoryStore();
  const factory = (key: string): EncryptedStore => {
    keys.push(key);
    const store = createEncryptedStore(backend, key);
    return {
      ...store,
      clearKeys: () => {
        cleared.push(key);
        store.clearKeys();
      },
    };
  };
  return { cleared, factory, keys };
};

describe("the open journal stores", () => {
  test("build one store per journal id, under its journal key, and keep it", () => {
    const { factory, keys } = recordingFactory();
    const journals = createQsbJournalStores(factory);
    const first = journals.forJournal(JOURNAL_ID_A);
    expect(first).not.toBeNull();
    expect(journals.forJournal(JOURNAL_ID_A)).toBe(first);
    expect(journals.forJournal(JOURNAL_ID_B)).not.toBe(first);
    expect(keys).toEqual([
      `bramble:qsb-journal:${JOURNAL_ID_A}`,
      `bramble:qsb-journal:${JOURNAL_ID_B}`,
    ]);
  });

  test("refuse anything that is not a journal id without calling the factory", () => {
    const { factory, keys } = recordingFactory();
    const journals = createQsbJournalStores(factory);
    for (const journalId of [
      "",
      JOURNAL_ID_A.slice(1),
      `${JOURNAL_ID_A}0`,
      JOURNAL_ID_A.toUpperCase(),
      `${JOURNAL_ID_A.slice(0, 63)}g`,
      `${JOURNAL_ID_A}:commit:${"0".repeat(32)}`,
      "vault",
    ]) {
      expect(journals.forJournal(journalId)).toBeNull();
    }
    expect(keys).toEqual([]);
  });

  test("drop every open store's keys together", () => {
    const { cleared, factory } = recordingFactory();
    const journals = createQsbJournalStores(factory);
    journals.clearKeys();
    expect(cleared).toEqual([]);
    journals.forJournal(JOURNAL_ID_A);
    journals.forJournal(JOURNAL_ID_B);
    journals.clearKeys();
    expect(cleared.sort()).toEqual(
      [`bramble:qsb-journal:${JOURNAL_ID_A}`, `bramble:qsb-journal:${JOURNAL_ID_B}`].sort(),
    );
  });

  test("open each account's pending deposits under their own key, beside its journal", () => {
    const { cleared, factory, keys } = recordingFactory();
    const stores = createQsbJournalStores(factory);
    const deposits = stores.forDeposits(JOURNAL_ID_A);
    expect(deposits).not.toBeNull();
    expect(stores.forDeposits(JOURNAL_ID_A)).toBe(deposits);
    expect(stores.forJournal(JOURNAL_ID_A)).not.toBe(deposits);
    expect(stores.forDeposits(JOURNAL_ID_A.toUpperCase())).toBeNull();
    expect(keys).toEqual([
      `bramble:qsb-deposit:${JOURNAL_ID_A}`,
      `bramble:qsb-journal:${JOURNAL_ID_A}`,
    ]);
    stores.clearKeys();
    expect(cleared.sort()).toEqual([...keys].sort());
  });

  test("keep nothing for an id whose store the factory could not build", () => {
    let fail = true;
    const { factory, keys } = recordingFactory();
    const journals = createQsbJournalStores((key) => {
      if (fail) throw new Error("storage unavailable");
      return factory(key);
    });
    expect(() => journals.forJournal(JOURNAL_ID_A)).toThrow("storage unavailable");
    fail = false;
    expect(journals.forJournal(JOURNAL_ID_A)).not.toBeNull();
    expect(keys).toEqual([`bramble:qsb-journal:${JOURNAL_ID_A}`]);
  });
});

// Chrome's storage.sync quotas: bytes in all (keys plus JSON values), bytes
// per item, and items.
const SYNC_QUOTA = { bytes: 102_400, itemBytes: 8_192, items: 512 } as const;

describe("the journals' commit records in storage.sync", () => {
  test("eight journals fit beside the vault's, at their largest, far inside every quota", async () => {
    const local = createMemoryStore();
    const sync = createMemoryStore();
    // Largest size each sync item ever reached, mid-write records included.
    const largest = new Map<string, number>();
    const measuredSync = {
      ...sync,
      async set(key: string, value: Json) {
        largest.set(
          key,
          Math.max(largest.get(key) ?? 0, key.length + JSON.stringify(value).length),
        );
        await sync.set(key, value);
      },
    };
    const wired = (key: string) => createEncryptedStore(local, key, measuredSync, undefined, true);
    const journals = createQsbJournalStores(wired);
    await wired("bramble:vault").write({ vault: true }, "correct horse battery staple");
    for (let index = 0; index < MAX_QSB_ACCOUNTS; index += 1) {
      const journalId = createHash("sha256").update(`sync budget ${index}`).digest("hex");
      const store = journals.forJournal(journalId);
      // Twice, so each record also goes through a write over a committed one.
      await store?.write({ index }, "correct horse battery staple");
      await store?.write({ index, again: true }, "correct horse battery staple");
    }
    const sizes = [...largest.values()];
    expect(sizes).toHaveLength(MAX_QSB_ACCOUNTS + 1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(211);
    expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThanOrEqual(1_828);
    expect(Math.max(...sizes)).toBeLessThan(SYNC_QUOTA.itemBytes);
    expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThan(SYNC_QUOTA.bytes / 50);
    expect(sizes.length).toBeLessThan(SYNC_QUOTA.items);
  });
});

describe("the pending-deposit records' commit records in storage.sync", () => {
  test("eight accounts' journals and pending deposits, and the vault, stay far inside every quota", async () => {
    const local = createMemoryStore();
    const sync = createMemoryStore();
    const largest = new Map<string, number>();
    const measuredSync = {
      ...sync,
      async set(key: string, value: Json) {
        largest.set(
          key,
          Math.max(largest.get(key) ?? 0, key.length + JSON.stringify(value).length),
        );
        await sync.set(key, value);
      },
    };
    const wired = (key: string) => createEncryptedStore(local, key, measuredSync, undefined, true);
    const stores = createQsbJournalStores(wired);
    await wired("bramble:vault").write({ vault: true }, "correct horse battery staple");
    for (let index = 0; index < MAX_QSB_ACCOUNTS; index += 1) {
      const journalId = createHash("sha256").update(`deposit budget ${index}`).digest("hex");
      for (const store of [stores.forJournal(journalId), stores.forDeposits(journalId)]) {
        await store?.write({ index }, "correct horse battery staple");
        await store?.write({ index, again: true }, "correct horse battery staple");
      }
    }
    const sizes = [...largest.values()];
    expect(sizes).toHaveLength(2 * MAX_QSB_ACCOUNTS + 1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(211);
    expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThanOrEqual(3_516);
    expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThan(SYNC_QUOTA.bytes / 25);
    expect(sizes.length).toBeLessThan(SYNC_QUOTA.items);
  });
});

describe("the journal-id drawer", () => {
  test("draws 32 random bytes as 64 lowercase hex digits, fresh every time", () => {
    const drawn = Array.from({ length: 16 }, randomQsbJournalId);
    for (const journalId of drawn) {
      expect(journalId).toMatch(/^[0-9a-f]{64}$/);
      expect(isQsbJournalId(journalId)).toBe(true);
    }
    expect(new Set(drawn).size).toBe(drawn.length);
  });
});
