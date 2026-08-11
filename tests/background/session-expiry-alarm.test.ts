/**
 * The unlock deadline is scheduled on `chrome.alarms` (MCW-V09-105). A
 * `setTimeout` cannot destroy an idle session because MV3 terminates the worker
 * first, so expiry has to be an alarm — and the adapter must replace the
 * pending wake on renewal, drop it on lock, and degrade to lazy expiry rather
 * than throw when the runtime has no alarms API.
 */
import { describe, expect, test } from "bun:test";
import { createUnlockSession, type UnlockSessionExpiryTimer } from "../../src/background/session";
import {
  createSessionExpiryTimer,
  type SessionAlarmsApi,
} from "../../src/background/session-expiry-alarm";
import { vaultPassphrase } from "../support/background-wallet-stub";

const TTL_MS = 1_000;
const UNLOCKED_AT = 1_000;

// The adapter answers `undefined` for a runtime with no alarms, which is its
// own test below. Every other test here is about the wired timer, so a missing
// one is a harness failure rather than the behaviour under test.
const wiredTimer = (alarms: SessionAlarmsApi): UnlockSessionExpiryTimer => {
  const timer = createSessionExpiryTimer(alarms);
  if (!timer) {
    throw new Error("expiry timer was not created for a runtime that has alarms");
  }
  return timer;
};

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

// A stand-in for `chrome.alarms` that records the pending wake and lets a test
// deliver it, the way the browser would after waking the worker.
const fakeAlarms = () => {
  const cleared: string[] = [];
  let listener: ((alarm: { readonly name: string }) => void) | null = null;
  let scheduled: { readonly name: string; readonly when: number } | null = null;
  const api: SessionAlarmsApi = {
    async clear(name) {
      cleared.push(name);
      scheduled = null;
      return true;
    },
    create(name, info) {
      scheduled = { name, when: info.when };
    },
    onAlarm: {
      addListener(next) {
        listener = next;
      },
    },
  };
  return {
    api,
    cleared: () => cleared,
    fire() {
      const due = scheduled;
      scheduled = null;
      if (due) {
        listener?.({ name: due.name });
      }
    },
    fireOther() {
      listener?.({ name: "mc-wallet:tx-observe-fast" });
    },
    scheduledAt: () => scheduled?.when ?? null,
  };
};

describe("unlock session expiry alarm", () => {
  test("destroys an idle session at its deadline with nothing polling", async () => {
    let now = UNLOCKED_AT;
    const alarms = fakeAlarms();
    const session = createUnlockSession({
      expiryTimer: wiredTimer(alarms.api),
      now: () => now,
      ttlMs: TTL_MS,
    });

    session.unlock(vaultPassphrase);
    expect(alarms.scheduledAt()).toBe(UNLOCKED_AT + TTL_MS);

    now = UNLOCKED_AT + TTL_MS + 1;
    alarms.fire();
    await flushMicrotasks();

    expect(session.peekPassphrase()).toBeNull();
  });

  test("re-arms at the later deadline when the window was renewed", () => {
    let now = UNLOCKED_AT;
    const alarms = fakeAlarms();
    const session = createUnlockSession({
      expiryTimer: wiredTimer(alarms.api),
      now: () => now,
      ttlMs: TTL_MS,
    });

    session.unlock(vaultPassphrase);
    now = UNLOCKED_AT + 500;
    expect(session.getPassphrase()).toBe(vaultPassphrase);

    now = UNLOCKED_AT + TTL_MS;
    alarms.fire();

    expect(session.peekPassphrase()).toBe(vaultPassphrase);
    expect(alarms.scheduledAt()).toBe(UNLOCKED_AT + 500 + TTL_MS);
  });

  test("clears the pending wake on an explicit lock", () => {
    const alarms = fakeAlarms();
    const session = createUnlockSession({
      expiryTimer: wiredTimer(alarms.api),
      now: () => UNLOCKED_AT,
      ttlMs: TTL_MS,
    });

    session.unlock(vaultPassphrase);
    session.lock();

    expect(alarms.scheduledAt()).toBeNull();
    expect(alarms.cleared()).toEqual(["mc-wallet:session-expiry"]);
  });

  test("ignores alarms belonging to other schedules", () => {
    let now = UNLOCKED_AT;
    const alarms = fakeAlarms();
    const session = createUnlockSession({
      expiryTimer: wiredTimer(alarms.api),
      now: () => now,
      ttlMs: TTL_MS,
    });

    session.unlock(vaultPassphrase);
    now = UNLOCKED_AT + TTL_MS + 1;
    alarms.fireOther();

    // The reconciliation cadence must not tear the session down, and must not
    // consume the pending unlock wake either.
    expect(alarms.scheduledAt()).toBe(UNLOCKED_AT + TTL_MS);
  });

  test("degrades to lazy expiry when the runtime exposes no alarms", () => {
    expect(createSessionExpiryTimer(undefined)).toBeUndefined();
  });

  test("degrades to lazy expiry when the listener cannot be registered", () => {
    const refusing: SessionAlarmsApi = {
      async clear() {
        return true;
      },
      create() {
        throw new Error("alarms unavailable");
      },
      onAlarm: {
        addListener() {
          throw new Error("alarms unavailable");
        },
      },
    };

    expect(createSessionExpiryTimer(refusing)).toBeUndefined();
  });

  test("a wake that cannot be scheduled never fires a stale callback", () => {
    let now = UNLOCKED_AT;
    const listeners: ((alarm: { readonly name: string }) => void)[] = [];
    const brittle: SessionAlarmsApi = {
      async clear() {
        return true;
      },
      create() {
        throw new Error("alarms unavailable");
      },
      onAlarm: {
        addListener(next) {
          listeners.push(next);
        },
      },
    };
    const session = createUnlockSession({
      expiryTimer: wiredTimer(brittle),
      now: () => now,
      ttlMs: TTL_MS,
    });

    session.unlock(vaultPassphrase);
    now = UNLOCKED_AT + 100;
    for (const listener of listeners) {
      listener({ name: "mc-wallet:session-expiry" });
    }

    // Nothing was scheduled, so nothing may be destroyed on a spurious wake.
    expect(session.peekPassphrase()).toBe(vaultPassphrase);
  });
});
