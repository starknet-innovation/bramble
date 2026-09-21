/**
 * Unlock session checks prove passphrases expire after real inactivity,
 * survive worker restarts through the session store, and never outlive lock.
 */

import { describe, expect, test } from "bun:test";
import { MIN_VAULT_PASSPHRASE_LENGTH } from "@bramble/wallet-model/passphrase";
import {
  createUnlockSession,
  type UnlockSessionMirrorEntry,
} from "../../../apps/extension/src/background/runtime/session";

const PASSPHRASE = "correct horse battery staple";

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

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createUnlockSession", () => {
  test("expires passphrases after inactivity", () => {
    let now = 1_000;
    const session = createUnlockSession({ now: () => now, ttlMs: 100 });

    session.unlock(PASSPHRASE);
    expect(session.getPassphrase()).toBe(PASSPHRASE);

    now = 1_101;
    expect(session.getPassphrase()).toBeNull();
    expect(session.isUnlocked()).toBe(false);
  });

  test("bumps the generation on unlock, lock, and expiry but not on activity", () => {
    let now = 1_000;
    const session = createUnlockSession({ now: () => now, ttlMs: 100 });

    const atStart = session.generation();
    session.unlock(PASSPHRASE);
    const afterUnlock = session.generation();
    expect(afterUnlock).not.toBe(atStart);

    // Activity (getPassphrase renewal) keeps the same session generation, so a
    // long-running op parked mid-session is not spuriously invalidated.
    now = 1_050;
    expect(session.getPassphrase()).toBe(PASSPHRASE);
    expect(session.generation()).toBe(afterUnlock);

    // An explicit lock changes the boundary.
    session.lock();
    const afterLock = session.generation();
    expect(afterLock).not.toBe(afterUnlock);

    // A re-unlock changes it again, so a stale pre-lock value never matches.
    session.unlock(PASSPHRASE);
    const afterReunlock = session.generation();
    expect(afterReunlock).not.toBe(afterLock);
    expect(afterReunlock).not.toBe(afterUnlock);

    // Lazy expiry clears the session and bumps the generation as well.
    now = 2_000;
    expect(session.getPassphrase()).toBeNull();
    expect(session.generation()).not.toBe(afterReunlock);
  });

  test("renews the expiry on activity instead of locking mid-use", () => {
    let now = 1_000;
    const session = createUnlockSession({ now: () => now, ttlMs: 100 });

    session.unlock(PASSPHRASE);
    now = 1_090;
    expect(session.getPassphrase()).toBe(PASSPHRASE);
    now = 1_180;
    expect(session.getPassphrase()).toBe(PASSPHRASE);
    now = 1_281;
    expect(session.getPassphrase()).toBeNull();
  });

  test("peeking never renews the expiry, so passive polling cannot hold the unlock", () => {
    let now = 1_000;
    const session = createUnlockSession({ now: () => now, ttlMs: 100 });

    session.unlock(PASSPHRASE);
    // Poll right up to the edge of the window: peeks must not push it out.
    now = 1_050;
    expect(session.peekPassphrase()).toBe(PASSPHRASE);
    now = 1_099;
    expect(session.peekPassphrase()).toBe(PASSPHRASE);
    expect(session.isUnlocked()).toBe(true);
    now = 1_101;
    expect(session.peekPassphrase()).toBeNull();
    expect(session.getPassphrase()).toBeNull();
  });

  test("isUnlocked reports without renewing the expiry", () => {
    let now = 1_000;
    const session = createUnlockSession({ now: () => now, ttlMs: 100 });

    session.unlock(PASSPHRASE);
    now = 1_099;
    expect(session.isUnlocked()).toBe(true);
    now = 1_101;
    expect(session.isUnlocked()).toBe(false);
  });

  test("peeking an expired session clears derived key material", () => {
    let now = 1_000;
    let cleared = 0;
    const session = createUnlockSession({
      now: () => now,
      onClear: () => {
        cleared += 1;
      },
      ttlMs: 100,
    });

    session.unlock(PASSPHRASE);
    now = 1_201;
    expect(session.peekPassphrase()).toBeNull();
    expect(cleared).toBe(1);
  });

  test("rejects unsafe passphrases", () => {
    const session = createUnlockSession();
    session.unlock(PASSPHRASE);

    // Below the shared floor, so the session refuses it and keeps the value it
    // already holds. Derived from the constant: if the floor moves, this keeps
    // testing the boundary instead of quietly passing a now-valid string.
    const belowFloor = "a".repeat(MIN_VAULT_PASSPHRASE_LENGTH - 1);
    expect(() => session.unlock(belowFloor)).toThrow("Invalid unlock session passphrase");
    expect(session.getPassphrase()).toBe(PASSPHRASE);
  });

  test("rejects unsafe ttl values", () => {
    expect(() => createUnlockSession({ ttlMs: 0 })).toThrow("Invalid unlock session ttl");
    expect(() => createUnlockSession({ ttlMs: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      "Invalid unlock session ttl",
    );
    expect(() => createUnlockSession({ ttlMs: 8 * 60 * 60 * 1000 + 1 })).toThrow(
      "Invalid unlock session ttl",
    );
  });

  test("mirrors unlocks to the session store and clears it on lock", async () => {
    const now = 1_000;
    const store = memoryStore();
    const session = createUnlockSession({ now: () => now, store, ttlMs: 100 });

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
    const first = createUnlockSession({ now: () => now, store, ttlMs: 100 });
    first.unlock(PASSPHRASE);
    await flushMicrotasks();

    const restarted = createUnlockSession({ now: () => now, store, ttlMs: 100 });
    await restarted.restore();
    expect(restarted.getPassphrase()).toBe(PASSPHRASE);

    now = 5_000;
    const tooLate = createUnlockSession({ now: () => now, store, ttlMs: 100 });
    await tooLate.restore();
    expect(tooLate.getPassphrase()).toBeNull();
  });

  test("clears derived key material on both lock and inactivity expiry", () => {
    let now = 1_000;
    let cleared = 0;
    const session = createUnlockSession({
      now: () => now,
      onClear: () => {
        cleared += 1;
      },
      ttlMs: 100,
    });

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
    const session = createUnlockSession({ now: () => 1_000, store, ttlMs: 100 });
    await session.restore();
    expect(session.getPassphrase()).toBeNull();
  });
});
