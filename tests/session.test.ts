/**
 * Unlock session checks prove passphrases expire after real inactivity,
 * survive worker restarts through the session store, and never outlive lock.
 */
import { describe, expect, test } from "bun:test";
import { createUnlockSession, type UnlockSessionState } from "../src/background/session";

const PASSPHRASE = "correct horse battery staple";

const memoryStore = () => {
  let state: UnlockSessionState | null = null;
  return {
    async clear() {
      state = null;
    },
    async load() {
      return state;
    },
    async save(next: UnlockSessionState) {
      state = next;
    },
    snapshot: () => state,
  };
};

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createUnlockSession", () => {
  test("expires passphrases after inactivity", () => {
    let now = 1_000;
    const session = createUnlockSession(100, () => now);

    session.unlock(PASSPHRASE);
    expect(session.getPassphrase()).toBe(PASSPHRASE);

    now = 1_101;
    expect(session.getPassphrase()).toBeNull();
    expect(session.isUnlocked()).toBe(false);
  });

  test("renews the expiry on activity instead of locking mid-use", () => {
    let now = 1_000;
    const session = createUnlockSession(100, () => now);

    session.unlock(PASSPHRASE);
    now = 1_090;
    expect(session.getPassphrase()).toBe(PASSPHRASE);
    now = 1_180;
    expect(session.getPassphrase()).toBe(PASSPHRASE);
    now = 1_281;
    expect(session.getPassphrase()).toBeNull();
  });

  test("rejects unsafe passphrases", () => {
    const session = createUnlockSession();
    session.unlock(PASSPHRASE);

    expect(() => session.unlock("too short")).toThrow("Invalid unlock session passphrase");
    expect(session.getPassphrase()).toBe(PASSPHRASE);
  });

  test("rejects unsafe ttl values", () => {
    expect(() => createUnlockSession(0)).toThrow("Invalid unlock session ttl");
    expect(() => createUnlockSession(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      "Invalid unlock session ttl",
    );
    expect(() => createUnlockSession(8 * 60 * 60 * 1000 + 1)).toThrow("Invalid unlock session ttl");
  });

  test("mirrors unlocks to the session store and clears it on lock", async () => {
    const now = 1_000;
    const store = memoryStore();
    const session = createUnlockSession(100, () => now, store);

    session.unlock(PASSPHRASE);
    await flushMicrotasks();
    expect(store.snapshot()).toEqual({ expiresAt: 1_100, passphrase: PASSPHRASE });

    session.lock();
    await flushMicrotasks();
    expect(store.snapshot()).toBeNull();
    expect(session.getPassphrase()).toBeNull();
  });

  test("restores an unexpired persisted session after a worker restart", async () => {
    let now = 1_000;
    const store = memoryStore();
    const first = createUnlockSession(100, () => now, store);
    first.unlock(PASSPHRASE);
    await flushMicrotasks();

    const restarted = createUnlockSession(100, () => now, store);
    await restarted.restore();
    expect(restarted.getPassphrase()).toBe(PASSPHRASE);

    now = 5_000;
    const tooLate = createUnlockSession(100, () => now, store);
    await tooLate.restore();
    expect(tooLate.getPassphrase()).toBeNull();
  });

  test("clears derived key material on both lock and inactivity expiry", () => {
    let now = 1_000;
    let cleared = 0;
    const session = createUnlockSession(
      100,
      () => now,
      undefined,
      () => {
        cleared += 1;
      },
    );

    session.unlock(PASSPHRASE);
    session.lock();
    expect(cleared).toBe(1);

    session.unlock(PASSPHRASE);
    now = 1_201;
    expect(session.getPassphrase()).toBeNull();
    expect(cleared).toBe(2);
  });

  test("ignores malformed persisted sessions", async () => {
    const store = {
      async clear() {},
      async load() {
        return { expiresAt: "soon", passphrase: PASSPHRASE };
      },
      async save() {},
    };
    const session = createUnlockSession(100, () => 1_000, store);
    await session.restore();
    expect(session.getPassphrase()).toBeNull();
  });
});
