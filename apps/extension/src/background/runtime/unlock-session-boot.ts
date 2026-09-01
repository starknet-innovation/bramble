/**
 * Browser wiring for the background worker's unlock session.
 *
 * Three boundaries meet here and nowhere else: the extension session-storage
 * mirror that lets an MV3 restart resume an unlock, the alarm that destroys an
 * idle session at its deadline, and the reaction every lock or expiry performs
 * — drop the derived vault keys and make sure the plaintext mirror is really
 * gone. Split from `./index` so the entrypoint stays a wiring list and the
 * session's browser dependencies have one home.
 *
 * Every part is optional-safe: a runtime with no session storage or no alarms
 * loses durability and time-driven expiry, never fail-open behaviour — the
 * session is still refused on every read past its deadline. The session-storage
 * area itself is constructed by the entrypoint and passed in, so this module
 * still holds no browser globals.
 */

import type { KeyValueStore } from "@bramble/store/kv";
import { createUnlockSession, type UnlockSession, type UnlockSessionStore } from "./session";
import { createSessionExpiryTimer, type SessionAlarmsApi } from "./session-expiry-alarm";

const SESSION_STORE_KEY = "mc-wallet:session";

// The extension's session storage area, narrowed to the three operations the
// unlock session needs and scoped to its one key. Absent when the caller has no
// session storage, in which case an unlock does not survive a worker restart.
const sessionMirror = (store: KeyValueStore | undefined): UnlockSessionStore | undefined =>
  store && {
    async clear() {
      await store.remove(SESSION_STORE_KEY);
    },
    async load() {
      return store.get(SESSION_STORE_KEY);
    },
    async save(entry) {
      await store.set(SESSION_STORE_KEY, entry);
    },
  };

/**
 * Builds the worker's one unlock session.
 *
 * `clearKeyCaches` is invoked on every lock and every expiry so no derived key
 * material (the vault AES key) outlives the unlock that produced it. A lock
 * that could not prove the mirror erased gets one further attempt on a later
 * tick, when a transient session-storage failure may have passed; the session
 * has already written its revocation marker by then, so a restarted worker
 * stays locked either way.
 */
export const createBackgroundUnlockSession = (input: {
  readonly alarms: SessionAlarmsApi | undefined;
  readonly clearKeyCaches: () => void;
  /** The extension's session-storage area, or undefined when unavailable. */
  readonly sessionStore: KeyValueStore | undefined;
}): UnlockSession => {
  const mirror = sessionMirror(input.sessionStore);
  // Both collaborators are absent-safe and both are omitted rather than passed
  // as `undefined`, which the options type forbids: an omitted mirror means an
  // unlock does not survive a worker restart, and an omitted timer means expiry
  // stays lazy. Neither omission ever fails open.
  const expiryTimer = createSessionExpiryTimer(input.alarms);
  return createUnlockSession({
    ...(expiryTimer ? { expiryTimer } : {}),
    onClear: (mirrorCleared) => {
      input.clearKeyCaches();
      void mirrorCleared.catch(() => mirror?.clear().catch(() => undefined));
    },
    ...(mirror ? { store: mirror } : {}),
  });
};
