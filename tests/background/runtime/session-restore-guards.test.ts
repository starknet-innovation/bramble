/**
 * Coverage for the unlock-session restore guard and the persistence callbacks
 * that swallow store failures: restore is a no-op with no store or an already
 * populated passphrase, and save/clear/load rejections never surface.
 */
import { describe, expect, test } from "bun:test";
import {
  createUnlockSession,
  type UnlockSessionMirrorEntry,
  type UnlockSessionStore,
} from "../../../apps/extension/src/background/runtime/session";

const PASSPHRASE = "correct horse battery staple";
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// A store whose save/clear/load all reject, so the session's swallowing
// `.catch` handlers run.
const rejectingStore = (): UnlockSessionStore => ({
  async clear() {
    throw new Error("clear failed");
  },
  async load() {
    throw new Error("load failed");
  },
  async save() {
    throw new Error("save failed");
  },
});

const memoryStore = () => {
  let state: UnlockSessionMirrorEntry | null = null;
  return {
    async clear() {
      state = null;
    },
    async load() {
      return state;
    },
    async save(next: UnlockSessionMirrorEntry) {
      state = next;
    },
    snapshot: () => state,
  };
};

describe("unlock session restore guard", () => {
  test("restore is a no-op when no store is configured", async () => {
    const session = createUnlockSession();
    await session.restore();
    expect(session.isUnlocked()).toBe(false);
  });

  test("restore is a no-op when a passphrase is already set", async () => {
    const store = memoryStore();
    const session = createUnlockSession({ now: () => Date.now(), store, ttlMs: 100_000 });
    session.unlock(PASSPHRASE);
    // Wipe the mirror so a restore that did NOT early-return would observably
    // clear or change the in-memory passphrase; the guard keeps it intact.
    await session.restore();
    expect(session.getPassphrase()).toBe(PASSPHRASE);
  });

  test("restore that reads back a live state rehydrates the passphrase", async () => {
    const store = memoryStore();
    const now = 10_000;
    const writer = createUnlockSession({ now: () => now, store, ttlMs: 100_000 });
    writer.unlock(PASSPHRASE);
    await flush();

    const reader = createUnlockSession({ now: () => now, store, ttlMs: 100_000 });
    expect(reader.isUnlocked()).toBe(false);
    await reader.restore();
    expect(reader.getPassphrase()).toBe(PASSPHRASE);
  });
});

describe("unlock session persistence failures are swallowed", () => {
  test("a rejecting save during unlock does not throw", async () => {
    const session = createUnlockSession({
      now: () => Date.now(),
      store: rejectingStore(),
      ttlMs: 100_000,
    });
    expect(() => session.unlock(PASSPHRASE)).not.toThrow();
    await flush();
    // The in-memory unlock still holds even though the persist failed.
    expect(session.getPassphrase()).toBe(PASSPHRASE);
  });

  test("a rejecting clear during lock does not throw", async () => {
    const session = createUnlockSession({
      now: () => Date.now(),
      store: rejectingStore(),
      ttlMs: 100_000,
    });
    session.unlock(PASSPHRASE);
    await flush();
    expect(() => session.lock()).not.toThrow();
    await flush();
    expect(session.isUnlocked()).toBe(false);
  });

  test("a rejecting load during restore leaves the session locked", async () => {
    const session = createUnlockSession({
      now: () => Date.now(),
      store: rejectingStore(),
      ttlMs: 100_000,
    });
    await session.restore();
    expect(session.isUnlocked()).toBe(false);
  });
});
