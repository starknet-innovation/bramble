/**
 * The worker's unlock session is wired to browser storage and alarms in one
 * place (MCW-V09-105, MCW-V09-114). These checks pin what that wiring must do:
 * mirror an unlock under the session key, drop the derived vault keys on every
 * lock and expiry, re-attempt an erase that could not be proven, and schedule
 * the deadline so an idle session is destroyed rather than merely refused.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@mc-wallet/core/json";
import { createMemoryStore } from "@mc-wallet/store/kv";
import type { SessionAlarmsApi } from "../../apps/extension/src/background/runtime/session-expiry-alarm";
import { createBackgroundUnlockSession } from "../../apps/extension/src/background/runtime/unlock-session-boot";
import { vaultPassphrase } from "../support/background-wallet-stub";

const SESSION_STORE_KEY = "mc-wallet:session";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

const recordingAlarms = () => {
  let scheduled: number | null = null;
  const api: SessionAlarmsApi = {
    async clear() {
      scheduled = null;
      return true;
    },
    create(_name, info) {
      scheduled = info.when;
    },
    onAlarm: { addListener() {} },
  };
  return { api, scheduledAt: () => scheduled };
};

describe("background unlock session wiring", () => {
  test("mirrors an unlock under the session key and arms the deadline", async () => {
    const store = createMemoryStore();
    const alarms = recordingAlarms();
    const session = createBackgroundUnlockSession({
      alarms: alarms.api,
      clearKeyCaches: () => undefined,
      sessionStore: store,
    });

    session.unlock(vaultPassphrase);
    await flushMicrotasks();

    expect(await store.get(SESSION_STORE_KEY)).toMatchObject({ passphrase: vaultPassphrase });
    expect(alarms.scheduledAt()).not.toBeNull();
  });

  test("drops derived key material and the mirror on lock", async () => {
    const store = createMemoryStore();
    let keyCacheDrops = 0;
    const session = createBackgroundUnlockSession({
      alarms: undefined,
      clearKeyCaches: () => {
        keyCacheDrops += 1;
      },
      sessionStore: store,
    });

    session.unlock(vaultPassphrase);
    await flushMicrotasks();
    session.lock();
    await session.mirrorCleared();

    expect(keyCacheDrops).toBe(1);
    expect(await store.get(SESSION_STORE_KEY)).toBeUndefined();
  });

  test("re-attempts an erase the session could not prove", async () => {
    const store = createMemoryStore();
    let removals = 0;
    // Storage that refuses both the removal and the revocation marker, so the
    // session cannot prove the plaintext gone and the entrypoint's later
    // attempt is the only thing left.
    const brittle = {
      ...store,
      async remove(key: string) {
        removals += 1;
        if (removals <= 3) {
          throw new Error("session storage unavailable");
        }
        await store.remove(key);
      },
      async set(key: string, value: Json) {
        if (typeof value === "object" && value !== null && "revoked" in value) {
          throw new Error("session storage unavailable");
        }
        await store.set(key, value);
      },
    };
    const session = createBackgroundUnlockSession({
      alarms: undefined,
      clearKeyCaches: () => undefined,
      sessionStore: brittle,
    });

    session.unlock(vaultPassphrase);
    await flushMicrotasks();
    session.lock();
    await flushMicrotasks();

    // Two attempts inside the session, then the entrypoint's later retry.
    expect(removals).toBe(3);
  });

  test("stays usable with no session storage and no alarms", () => {
    const session = createBackgroundUnlockSession({
      alarms: undefined,
      clearKeyCaches: () => undefined,
      sessionStore: undefined,
    });

    session.unlock(vaultPassphrase);
    expect(session.peekPassphrase()).toBe(vaultPassphrase);
    session.lock();
    expect(session.isUnlocked()).toBe(false);
  });
});
