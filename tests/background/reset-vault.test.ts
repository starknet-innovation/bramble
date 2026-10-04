/**
 * wallet.resetVault (#456): the forgotten-passphrase route archives the
 * encrypted vault and clears the live copy so the next start is first-run. It
 * carries no passphrase, so it must be privileged to extension pages, it must
 * fail closed when no reset route is wired, and it must never clear storage
 * until the plaintext session mirror is confirmed erased.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import {
  createUnlockSession,
  type UnlockSessionMirrorEntry,
} from "../../apps/extension/src/background/runtime/session";
import {
  contentSender,
  createWallet,
  extensionSender,
  testExtension,
  vaultPassphrase,
} from "../support/background-wallet-stub";

const TTL_MS = 1_000;
const NOW = 1_000;

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

const makeSession = (store?: {
  clear: () => Promise<void>;
  load: () => Promise<UnlockSessionMirrorEntry | null>;
  save: (entry: UnlockSessionMirrorEntry) => Promise<void>;
}) =>
  createUnlockSession({
    now: () => NOW,
    ...(store ? { store } : {}),
    ttlMs: TTL_MS,
  });

describe("wallet.resetVault", () => {
  test("only an extension page may reinitialize the wallet", async () => {
    const calls: string[] = [];
    const handler = createMessageHandler(
      createWallet({
        resetVault: async () => {
          calls.push("reset");
          return { archived: true };
        },
      }),
      testExtension,
      { session: makeSession() },
    );

    expect(await handler({ type: "wallet.resetVault" }, contentSender)).toEqual({
      error: "privileged sender required",
    });
    expect(calls).toEqual([]);
  });

  test("archives, clears, and locks for an extension page", async () => {
    const calls: string[] = [];
    const session = makeSession();
    session.unlock(vaultPassphrase);
    await flushMicrotasks();
    const handler = createMessageHandler(
      createWallet({
        resetVault: async () => {
          calls.push("reset");
          return { archived: true };
        },
      }),
      testExtension,
      { session },
    );

    const response = await handler({ type: "wallet.resetVault" }, extensionSender);

    expect(response).toEqual({ archived: true, ok: true });
    expect(calls).toEqual(["reset"]);
    // The reset drops the in-memory passphrase regardless of where it started.
    expect(session.isUnlocked()).toBe(false);
    expect(session.peekPassphrase()).toBeNull();
  });

  test("fails closed when no reset route is wired", async () => {
    const handler = createMessageHandler(createWallet(), testExtension, {
      session: makeSession(),
    });

    expect(await handler({ type: "wallet.resetVault" }, extensionSender)).toEqual({
      error: "wallet unavailable",
    });
  });

  test("does not clear storage when the session mirror cannot be proven erased", async () => {
    const calls: string[] = [];
    const session = makeSession({
      async clear() {
        throw new Error("session storage unavailable");
      },
      async load() {
        return null;
      },
      async save() {
        throw new Error("session storage unavailable");
      },
    });
    session.unlock(vaultPassphrase);
    await flushMicrotasks();
    const handler = createMessageHandler(
      createWallet({
        resetVault: async () => {
          calls.push("reset");
          return { archived: true };
        },
      }),
      testExtension,
      { session },
    );

    const response = await handler({ type: "wallet.resetVault" }, extensionSender);

    expect(response).toEqual({ error: "wallet reset incomplete" });
    expect(calls).toEqual([]);
    expect(session.peekPassphrase()).toBeNull();
  });
});
