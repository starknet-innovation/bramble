/**
 * Auto-lock invariants (MCW-V09-105). Renewing the inactivity window is a
 * privilege of user-initiated extension-page operations, never a side effect of
 * having parsed a message: a dapp polling from any open tab and the side
 * panel's own ambient refresh must both observe the session without extending
 * it. Destruction is time-driven too — with an expiry timer wired the session
 * and its plaintext mirror are torn down at the deadline even if nothing ever
 * reads them again.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import {
  createUnlockSession,
  type UnlockSessionMirrorEntry,
} from "../../apps/extension/src/background/runtime/session";
import {
  contentSender,
  createWallet,
  extensionSender,
  grantedOrigin,
  vaultPassphrase,
} from "../support/background-wallet-stub";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";

const TTL_MS = 1_000;
const UNLOCKED_AT = 1_000;
const EXPIRES_AT = UNLOCKED_AT + TTL_MS;

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

// A hand-driven stand-in for the chrome.alarms wake: `schedule` replaces any
// pending wake (as alarms keyed by one name do) and `fire` delivers it.
const makeExpiryTimer = () => {
  let pending: { readonly at: number; readonly onElapsed: () => void } | null = null;
  return {
    cancel() {
      pending = null;
    },
    fire() {
      const due = pending;
      pending = null;
      due?.onElapsed();
    },
    scheduledAt: () => pending?.at ?? null,
    schedule(at: number, onElapsed: () => void) {
      pending = { at, onElapsed };
    },
  };
};

const memoryMirror = () => {
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

// The stub vault lives on SN_SEPOLIA, so the harness selects that network up
// front and every handler under test resolves a real active account.
const makeHarness = async () => {
  let now = UNLOCKED_AT;
  const session = createUnlockSession({ now: () => now, ttlMs: TTL_MS });
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork("SN_SEPOLIA");
  const handler = createMessageHandler(createWallet(), "extension-id", {
    preferencesStore,
    runtimeRpc: makeRuntimeRpc({
      async estimateAccountDeploymentFee() {
        return { overallFee: "1", unit: "FRI" };
      },
    }),
    session,
  });
  session.unlock(vaultPassphrase);
  return {
    advanceTo(next: number) {
      now = next;
    },
    handler,
    session,
  };
};

describe("unlock session renewal is a privilege, not a parsing side effect", () => {
  test("a dapp polling wallet.getPermissions cannot hold the wallet unlocked", async () => {
    const harness = await makeHarness();

    // A page can issue this on a timer from any open tab. Poll just before the
    // deadline: if the read renewed the window the wallet would never lock.
    harness.advanceTo(EXPIRES_AT - 1);
    const response = await harness.handler(
      { origin: grantedOrigin, type: "wallet.getPermissions" },
      contentSender,
    );
    expect(response).toEqual({ ok: true, permissions: ["accounts"] });

    harness.advanceTo(EXPIRES_AT + 1);
    expect(harness.session.isUnlocked()).toBe(false);
  });

  test("a dapp invoke request cannot hold the wallet unlocked", async () => {
    const harness = await makeHarness();

    harness.advanceTo(EXPIRES_AT - 1);
    // The request parks as an approval and its response is held until the user
    // decides, so the handler promise is deliberately not awaited here; the
    // session read under test happens before the approval is queued.
    void harness.handler(
      {
        calls: [{ calldata: [], contractAddress: "0xabcabcdef", entrypoint: "transfer" }],
        origin: grantedOrigin,
        type: "wallet.addInvokeTransaction",
      },
      contentSender,
    );
    await flushMicrotasks();

    harness.advanceTo(EXPIRES_AT + 1);
    expect(harness.session.isUnlocked()).toBe(false);
  });

  test("the side panel's ambient refresh cannot hold the wallet unlocked", async () => {
    const harness = await makeHarness();

    // These are exactly what the visible panel polls on its ~15s cadence.
    harness.advanceTo(EXPIRES_AT - 1);
    expect(await harness.handler({ type: "wallet.getBalances" }, extensionSender)).toMatchObject({
      ok: true,
    });
    expect(
      await harness.handler({ type: "wallet.transactionAlerts" }, extensionSender),
    ).toMatchObject({ ok: true });
    expect(await harness.handler({ type: "wallet.activity" }, extensionSender)).toMatchObject({
      ok: true,
    });
    expect(
      await harness.handler({ type: "wallet.deploymentStatus" }, extensionSender),
    ).toMatchObject({ ok: true });

    harness.advanceTo(EXPIRES_AT + 1);
    expect(harness.session.isUnlocked()).toBe(false);
  });

  test("no view the panel can be left open on renews the window", async () => {
    const harness = await makeHarness();

    // Whichever view is showing, its list is re-hydrated on the same ambient
    // cadence. Leaving the panel parked on any of them must not be enough to
    // keep the wallet unlocked — the user has to actually do something.
    harness.advanceTo(EXPIRES_AT - 1);
    for (const type of [
      "wallet.allowances",
      "wallet.connectedSites",
      "wallet.loadWatchedNfts",
      "wallet.multisigs",
      "wallet.verifyClassHash",
    ]) {
      expect(await harness.handler({ type }, extensionSender)).toMatchObject({ ok: true });
    }
    expect(
      await harness.handler({ includeWatched: true, type: "wallet.discoverNfts" }, extensionSender),
    ).toMatchObject({ ok: true });
    await flushMicrotasks();

    harness.advanceTo(EXPIRES_AT + 1);
    expect(harness.session.isUnlocked()).toBe(false);
  });

  test("a user-initiated extension-page operation still renews the window", async () => {
    const harness = await makeHarness();

    harness.advanceTo(EXPIRES_AT - 1);
    expect(await harness.handler({ type: "wallet.deployAccount" }, extensionSender)).toMatchObject({
      ok: true,
    });

    harness.advanceTo(EXPIRES_AT + 1);
    expect(harness.session.isUnlocked()).toBe(true);
  });
});

describe("time-driven expiry", () => {
  test("destroys the session and its plaintext mirror with nothing polling", async () => {
    let now = UNLOCKED_AT;
    let derivedKeysCleared = 0;
    const mirror = memoryMirror();
    const timer = makeExpiryTimer();
    const session = createUnlockSession({
      expiryTimer: timer,
      now: () => now,
      onClear: () => {
        derivedKeysCleared += 1;
      },
      store: mirror,
      ttlMs: TTL_MS,
    });

    session.unlock(vaultPassphrase);
    await flushMicrotasks();
    expect(timer.scheduledAt()).toBe(EXPIRES_AT);
    expect(mirror.snapshot()).toEqual({ expiresAt: EXPIRES_AT, passphrase: vaultPassphrase });

    // No handler runs between the unlock and the deadline: the wake is the only
    // thing that happens, and it must be enough to erase the passphrase.
    now = EXPIRES_AT + 1;
    timer.fire();
    await flushMicrotasks();

    expect(mirror.snapshot()).toBeNull();
    expect(derivedKeysCleared).toBe(1);
    expect(session.peekPassphrase()).toBeNull();
  });

  test("re-arms at the later deadline when the window was renewed", async () => {
    let now = UNLOCKED_AT;
    const mirror = memoryMirror();
    const timer = makeExpiryTimer();
    const session = createUnlockSession({
      expiryTimer: timer,
      now: () => now,
      store: mirror,
      ttlMs: TTL_MS,
    });

    session.unlock(vaultPassphrase);
    now = UNLOCKED_AT + 500;
    expect(session.getPassphrase()).toBe(vaultPassphrase);

    // The wake armed at the original deadline arrives while the session is
    // still live: it must re-arm rather than destroy a renewed session.
    now = EXPIRES_AT;
    timer.fire();
    expect(session.peekPassphrase()).toBe(vaultPassphrase);
    expect(timer.scheduledAt()).toBe(UNLOCKED_AT + 500 + TTL_MS);

    now = UNLOCKED_AT + 500 + TTL_MS + 1;
    timer.fire();
    await flushMicrotasks();
    expect(session.peekPassphrase()).toBeNull();
    expect(mirror.snapshot()).toBeNull();
  });

  test("cancels the pending wake on an explicit lock", () => {
    const timer = makeExpiryTimer();
    const session = createUnlockSession({
      expiryTimer: timer,
      now: () => UNLOCKED_AT,
      ttlMs: TTL_MS,
    });

    session.unlock(vaultPassphrase);
    expect(timer.scheduledAt()).toBe(EXPIRES_AT);
    session.lock();
    expect(timer.scheduledAt()).toBeNull();
  });

  test("arms the wake for a session restored after a worker restart", async () => {
    const now = UNLOCKED_AT;
    const mirror = memoryMirror();
    const writer = createUnlockSession({ now: () => now, store: mirror, ttlMs: TTL_MS });
    writer.unlock(vaultPassphrase);
    await flushMicrotasks();

    const timer = makeExpiryTimer();
    const restarted = createUnlockSession({
      expiryTimer: timer,
      now: () => now,
      store: mirror,
      ttlMs: TTL_MS,
    });
    await restarted.restore();

    expect(restarted.peekPassphrase()).toBe(vaultPassphrase);
    expect(timer.scheduledAt()).toBe(EXPIRES_AT);
  });
});
