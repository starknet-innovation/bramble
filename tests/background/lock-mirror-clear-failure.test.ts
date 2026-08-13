/**
 * Explicit lock fails closed when the plaintext session mirror survives
 * (MCW-V09-114). Dropping the in-memory passphrase is only half a lock: the
 * mirror in the extension's session storage holds the same plaintext, and it
 * outlives the MV3 worker that wrote it. So three things must hold. The erase
 * must be proven, not swallowed. When the entry cannot be removed it must be
 * overwritten with a revocation marker, because an in-memory "this failed"
 * latch dies with the worker while the mirror does not. And a save that was
 * already in flight must never land after the erase and republish the secret
 * the user just revoked.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import {
  createUnlockSession,
  type UnlockSessionMirrorEntry,
} from "../../apps/extension/src/background/runtime/session";
import { createWallet, extensionSender, vaultPassphrase } from "../support/background-wallet-stub";

const TTL_MS = 1_000;
const NOW = 1_000;
const REVOKED: UnlockSessionMirrorEntry = { revoked: true };

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

// A session mirror whose erase fails the first `clearFailures` times it is
// called. `clearFailures: Number.POSITIVE_INFINITY` models storage that never
// lets go of the entry; `saveFails` additionally models storage that will not
// accept the revocation marker either, which is the only case where nothing
// can be proven about the plaintext.
const brittleMirror = ({
  clearFailures,
  saveFails = false,
}: {
  readonly clearFailures: number;
  readonly saveFails?: boolean;
}) => {
  let state: UnlockSessionMirrorEntry | null = null;
  let clearCalls = 0;
  return {
    clearCalls: () => clearCalls,
    async clear() {
      clearCalls += 1;
      if (clearCalls <= clearFailures) {
        throw new Error("session storage unavailable");
      }
      state = null;
    },
    async load() {
      return state;
    },
    async save(next: UnlockSessionMirrorEntry) {
      if (saveFails) {
        throw new Error("session storage unavailable");
      }
      state = next;
    },
    snapshot: () => state,
  };
};

describe("unlock session mirror clear", () => {
  test("retries once so a transient storage failure still confirms the lock", async () => {
    const mirror = brittleMirror({ clearFailures: 1 });
    const session = createUnlockSession({ now: () => NOW, store: mirror, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    await flushMicrotasks();

    session.lock();

    await expect(session.mirrorCleared()).resolves.toBeUndefined();
    expect(mirror.clearCalls()).toBe(2);
    expect(mirror.snapshot()).toBeNull();
  });

  test("overwrites the plaintext with a revocation marker when it cannot be removed", async () => {
    const mirror = brittleMirror({ clearFailures: Number.POSITIVE_INFINITY });
    const session = createUnlockSession({ now: () => NOW, store: mirror, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    await flushMicrotasks();

    session.lock();

    // The passphrase is gone from session storage, which is the whole security
    // claim of a lock, so this resolves — but nothing readable is left behind.
    await expect(session.mirrorCleared()).resolves.toBeUndefined();
    expect(mirror.snapshot()).toEqual(REVOKED);
    expect(session.peekPassphrase()).toBeNull();
  });

  test("reports a mirror it could neither erase nor overwrite", async () => {
    const mirror = brittleMirror({ clearFailures: Number.POSITIVE_INFINITY, saveFails: true });
    const session = createUnlockSession({ now: () => NOW, store: mirror, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    await flushMicrotasks();

    session.lock();

    await expect(session.mirrorCleared()).rejects.toThrow("Unlock session mirror not cleared");
    // The in-memory secret is still dropped synchronously; what failed is the
    // proof that the mirrored copy is gone.
    expect(session.peekPassphrase()).toBeNull();
  });

  test("a fresh worker refuses to resurrect a session whose lock could not erase it", async () => {
    const mirror = brittleMirror({ clearFailures: Number.POSITIVE_INFINITY });
    const session = createUnlockSession({ now: () => NOW, store: mirror, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    await flushMicrotasks();

    session.lock();
    await session.mirrorCleared();

    // This is what MV3 actually does on every worker wake: a brand-new session
    // over the same session-storage entry. The revoked marker is the only thing
    // that can stop it, because the failure latch died with the old worker.
    const restarted = createUnlockSession({ now: () => NOW, store: mirror, ttlMs: TTL_MS });
    await restarted.restore();

    expect(restarted.isUnlocked()).toBe(false);
    expect(restarted.peekPassphrase()).toBeNull();
  });

  test("a restore racing the erase a lock just issued cannot reload the secret", async () => {
    const mirror = brittleMirror({ clearFailures: 0 });
    const session = createUnlockSession({ now: () => NOW, store: mirror, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    await flushMicrotasks();

    // No await between the lock and the restore: the entry is still in session
    // storage at this instant, and a restore that read it now would undo the
    // lock the user just performed.
    session.lock();
    await session.restore();

    expect(session.isUnlocked()).toBe(false);
    expect(mirror.snapshot()).toBeNull();
  });

  test("the same worker refuses to resurrect a mirror it could not prove erased", async () => {
    const mirror = brittleMirror({ clearFailures: Number.POSITIVE_INFINITY, saveFails: true });
    const session = createUnlockSession({ now: () => NOW, store: mirror, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    await flushMicrotasks();

    session.lock();
    await expect(session.mirrorCleared()).rejects.toThrow("Unlock session mirror not cleared");

    // The mirror still holds an unexpired snapshot, but this session locked and
    // must stay locked rather than reload the secret the user just revoked.
    await session.restore();
    expect(session.peekPassphrase()).toBeNull();
    expect(session.isUnlocked()).toBe(false);
  });

  test("a mirror write already in flight cannot land after the clear", async () => {
    let releaseSave = (): void => undefined;
    const saved = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let state: UnlockSessionMirrorEntry | null = null;
    const slowMirror = {
      async clear() {
        state = null;
      },
      async load() {
        return state;
      },
      async save(next: UnlockSessionMirrorEntry) {
        await saved;
        state = next;
      },
      snapshot: () => state,
    };
    const session = createUnlockSession({ now: () => NOW, store: slowMirror, ttlMs: TTL_MS });

    session.unlock(vaultPassphrase);
    // Let the unlock's save reach the store and block there, so it is genuinely
    // in flight — not merely queued — when the user locks.
    await flushMicrotasks();
    session.lock();
    releaseSave();
    await session.mirrorCleared();

    expect(slowMirror.snapshot()).toBeNull();
    expect(session.isUnlocked()).toBe(false);
  });

  test("a session with no mirror wired confirms its lock immediately", async () => {
    const session = createUnlockSession({ now: () => NOW, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);

    session.lock();

    await expect(session.mirrorCleared()).resolves.toBeUndefined();
  });

  test("surfaces an expiry-path erase failure through the clear boundary", async () => {
    let now = NOW;
    const mirror = brittleMirror({ clearFailures: Number.POSITIVE_INFINITY, saveFails: true });
    const outcomes: string[] = [];
    const session = createUnlockSession({
      now: () => now,
      onClear: (mirrorCleared) => {
        void mirrorCleared.then(
          () => outcomes.push("cleared"),
          () => outcomes.push("retained"),
        );
      },
      store: mirror,
      ttlMs: TTL_MS,
    });
    session.unlock(vaultPassphrase);
    await flushMicrotasks();

    // Nobody locks: the window simply expires and the next read tears it down.
    now = NOW + TTL_MS + 1;
    expect(session.peekPassphrase()).toBeNull();
    await flushMicrotasks();

    expect(outcomes).toEqual(["retained"]);
  });

  test("erases a mirror entry that outlived its deadline on the next worker start", async () => {
    let now = NOW;
    const mirror = brittleMirror({ clearFailures: 0 });
    const writer = createUnlockSession({ now: () => now, store: mirror, ttlMs: TTL_MS });
    writer.unlock(vaultPassphrase);
    await flushMicrotasks();

    now = NOW + TTL_MS + 1;
    const restarted = createUnlockSession({ now: () => now, store: mirror, ttlMs: TTL_MS });
    await restarted.restore();
    await restarted.mirrorCleared();

    expect(restarted.isUnlocked()).toBe(false);
    expect(mirror.snapshot()).toBeNull();
  });
});

describe("wallet.lock", () => {
  const makeHandler = (session: ReturnType<typeof createUnlockSession>) =>
    createMessageHandler(createWallet(), "extension-id", { session });

  test("does not report a lock it could not complete", async () => {
    const mirror = brittleMirror({ clearFailures: Number.POSITIVE_INFINITY, saveFails: true });
    const session = createUnlockSession({ now: () => NOW, store: mirror, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    await flushMicrotasks();

    const response = await makeHandler(session)({ type: "wallet.lock" }, extensionSender);

    expect(response).toEqual({ error: "wallet lock incomplete" });
  });

  test("reports a locked wallet once the mirror is confirmed erased", async () => {
    const mirror = brittleMirror({ clearFailures: 0 });
    const session = createUnlockSession({ now: () => NOW, store: mirror, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    await flushMicrotasks();

    const response = await makeHandler(session)({ type: "wallet.lock" }, extensionSender);

    expect(response).toMatchObject({ accounts: [], locked: true });
    expect(mirror.snapshot()).toBeNull();
  });
});
