/**
 * The panel lock is the grant tab's signal that its side panel is gone. These
 * tests use a fake lock manager so they do not depend on a browser.
 */
import { describe, expect, test } from "bun:test";
import {
  holdLedgerPanelLock,
  isLedgerPanelLockLive,
  type LedgerLockManager,
  ledgerPanelLockName,
  watchLedgerPanelLock,
} from "@bramble/ledger-browser/panel-presence";

const SESSION = "00000000-0000-4000-8000-0000000000ab";

type Holder = {
  readonly locks: LedgerLockManager;
  readonly release: (name: string) => void;
};

const manager = (): Holder => {
  const held = new Map<string, () => void>();
  const pending: { name: string; grant: () => void }[] = [];

  const grantNext = (name: string): void => {
    const index = pending.findIndex((entry) => entry.name === name);
    const next = index < 0 ? undefined : pending.splice(index, 1)[0];
    if (!next) return;
    held.set(name, next.grant);
    next.grant();
  };

  const locks: LedgerLockManager = {
    query: async () => ({
      held: [...held.keys()].map((name) => ({ name })),
      pending: pending.map((entry) => ({ name: entry.name })),
    }),
    request: (name, callback) =>
      new Promise((resolve, reject) => {
        let started = false;
        const grant = (): void => {
          if (started) return;
          started = true;
          void callback()
            .then(() => {
              if (held.get(name) === grant) held.delete(name);
              grantNext(name);
              resolve(undefined);
            })
            .catch(reject);
        };
        if (!held.has(name)) {
          held.set(name, grant);
          grant();
          return;
        }
        pending.push({ grant, name });
      }),
  };

  return {
    locks,
    release: (name) => {
      const grant = held.get(name);
      held.delete(name);
      grant?.();
      // The hold callback resolves `released` by calling the function we
      // returned. Tests release through that function, not here.
    },
  };
};

describe("ledger panel lock", () => {
  test("the name is scoped to the session", () => {
    expect(ledgerPanelLockName(SESSION)).toBe(`bramble-ledger-panel:${SESSION}`);
  });

  test("hold resolves immediately and keeps the lock until release", async () => {
    const fake = manager();
    const release = await holdLedgerPanelLock(fake.locks, SESSION);
    const state = await fake.locks.query?.();
    expect(state?.held?.map((lock) => lock.name)).toEqual([ledgerPanelLockName(SESSION)]);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const after = await fake.locks.query?.();
    expect(after?.held ?? []).toEqual([]);
  });

  test("watch waits until the panel releases, then reports it gone", async () => {
    const fake = manager();
    const release = await holdLedgerPanelLock(fake.locks, SESSION);
    let gone = false;
    const watching = watchLedgerPanelLock(fake.locks, SESSION).then((value) => {
      gone = value;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gone).toBe(false);
    release();
    await watching;
    expect(gone).toBe(true);
  });

  test("watch does not fire when the panel never took the lock", async () => {
    const fake = manager();
    const gone = await watchLedgerPanelLock(fake.locks, SESSION);
    expect(gone).toBe(false);
  });

  test("a lock request that fails before granting resolves to a no-op", async () => {
    const locks: LedgerLockManager = {
      request: () => Promise.reject(new DOMException("not active", "InvalidStateError")),
    };
    const release = await holdLedgerPanelLock(locks, SESSION);
    expect(typeof release).toBe("function");
    release();
  });

  test("liveness reports a held lock and an absent one", async () => {
    const fake = manager();
    expect(await isLedgerPanelLockLive(fake.locks, SESSION)).toBe(false);
    const release = await holdLedgerPanelLock(fake.locks, SESSION);
    expect(await isLedgerPanelLockLive(fake.locks, SESSION)).toBe(true);
    release();
  });

  test("a missing lock manager does not block the caller", async () => {
    const release = await holdLedgerPanelLock(null, SESSION);
    expect(typeof release).toBe("function");
    release();
  });
});
