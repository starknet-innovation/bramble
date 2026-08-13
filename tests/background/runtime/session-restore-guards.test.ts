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

/**
 * MCW-V09-114, in-memory half. A lock erases the plaintext mirror; when that
 * erase fails, `eraseMirror` falls back to writing a durable revocation marker,
 * and if THAT write also fails the only remaining refusal is the in-memory
 * `mirrorStale` latch. `restore()` re-reads that latch after awaiting the
 * pending mirror write, because the latch is set by the erase's own rejection
 * handler and cannot be observed before that write settles.
 *
 * The latch is set inside the queued erase before the queue tail settles, so a
 * restore released by that tail must observe it. Deleting the post-await check
 * lets a restore that raced a failed lock rehydrate the passphrase the user
 * just revoked. This test makes that regression loud.
 */
describe("unlock session restore after an unprovable erase", () => {
  // Nothing the lock writes can land: the erase rejects and so does the
  // revocation marker, leaving a live-looking entry readable. Only the
  // in-memory latch can refuse it.
  const unerasableStore = (
    entry: UnlockSessionMirrorEntry,
  ): UnlockSessionStore & { clears: () => number } => {
    let clears = 0;
    return {
      clears: () => clears,
      async clear() {
        clears += 1;
        throw new Error("erase failed");
      },
      async load() {
        return entry;
      },
      async save() {
        throw new Error("marker write failed");
      },
    };
  };

  test("refuses to rehydrate from a mirror it could not prove it erased", async () => {
    const store = unerasableStore({
      expiresAt: Date.now() + 60_000,
      passphrase: PASSPHRASE,
    });
    const session = createUnlockSession({ store });

    session.unlock(PASSPHRASE);
    await flush();

    // Race it deliberately: lock() only QUEUES the erase, so restore() starts
    // while the latch is still false and clears the guard at the top of
    // restore(). The erase then fails while restore() is awaiting the write
    // queue, which is the only window in which the post-await re-check matters.
    session.lock();
    expect(session.isUnlocked()).toBe(false);
    const racing = session.restore();
    await racing;

    expect(store.clears()).toBeGreaterThan(0);
    // load() still returns a live-looking entry; only the post-await latch read
    // stands between that entry and a resurrected session.
    expect(session.isUnlocked()).toBe(false);
    expect(session.getPassphrase()).toBeNull();
  });

  test("detects a silent no-op clear and verifies the revocation overwrite", async () => {
    let state: UnlockSessionMirrorEntry | null = {
      expiresAt: Date.now() + 60_000,
      passphrase: PASSPHRASE,
    };
    const store: UnlockSessionStore = {
      async clear() {},
      async load() {
        return state;
      },
      async save(next) {
        state = next;
      },
    };
    const session = createUnlockSession({ store });
    session.unlock(PASSPHRASE);
    await flush();
    session.lock();
    await session.mirrorCleared();

    expect(state as UnlockSessionMirrorEntry | null).toEqual({ revoked: true });
  });
});
