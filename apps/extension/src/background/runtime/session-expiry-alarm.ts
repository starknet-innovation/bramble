/**
 * `chrome.alarms` boundary for unlock-session expiry.
 *
 * The inactivity window is only real if something destroys the session at its
 * deadline. A `setTimeout` cannot: an MV3 service worker is terminated when
 * idle, so a 30-minute timer is a coin flip. An alarm survives worker
 * termination and wakes the worker back up, which is exactly the case that
 * matters — nobody is polling the wallet, so nothing else would ever notice
 * that the plaintext mirror in session storage has outlived its TTL.
 *
 * This module holds the alarm API and nothing else: the expiry policy lives in
 * `./session`, which receives the timer through {@link UnlockSessionExpiryTimer}
 * and reads no ambient clock or scheduler of its own.
 */

import type { UnlockSessionExpiryTimer } from "./session";

/**
 * Alarm name for the pending unlock deadline. One name means one pending wake:
 * creating it again replaces the previous alarm, which is precisely the
 * "replace any pending wake" contract the session expects from `schedule`.
 */
const SESSION_EXPIRY_ALARM = "bramble:session-expiry";

/**
 * The slice of `chrome.alarms` this module uses. Declared structurally so the
 * worker passes the real API and tests pass a double. `create` here takes an
 * absolute `when`, unlike the recurring cadence alarms in `./tx-monitor`.
 */
export type SessionAlarmsApi = {
  readonly clear: (name: string) => Promise<boolean>;
  readonly create: (name: string, info: { readonly when: number }) => void;
  readonly onAlarm: {
    readonly addListener: (listener: (alarm: { readonly name: string }) => void) => void;
  };
};

/**
 * Wires unlock-session expiry to `chrome.alarms`.
 *
 * Returns `undefined` when the runtime exposes no alarms API or refuses the
 * listener, so the caller can leave the session on its lazy-expiry behaviour —
 * still refused on every read past the deadline — rather than pretending a wake
 * was scheduled. Alarm failures never throw into the session: a wake that
 * cannot be scheduled degrades to lazy expiry, it does not extend anything.
 */
export const createSessionExpiryTimer = (
  alarms: SessionAlarmsApi | undefined,
): UnlockSessionExpiryTimer | undefined => {
  if (!alarms) {
    return undefined;
  }
  // The pending callback is worker-local: after a restart the alarm may still
  // fire with nothing registered. That is safe because the worker's startup
  // path restores the session from the mirror, which re-arms this alarm for a
  // live session and erases the mirror for an expired one.
  let pending: (() => void) | null = null;
  try {
    alarms.onAlarm.addListener((alarm) => {
      if (alarm.name !== SESSION_EXPIRY_ALARM) {
        return;
      }
      const elapsed = pending;
      pending = null;
      elapsed?.();
    });
  } catch {
    return undefined;
  }
  return {
    cancel() {
      pending = null;
      try {
        void alarms.clear(SESSION_EXPIRY_ALARM).catch(() => undefined);
      } catch {
        // A structural test double can throw synchronously, and browser APIs
        // have done so when their runtime context was already invalidated.
      }
    },
    schedule(atMs, onElapsed) {
      pending = onElapsed;
      try {
        alarms.create(SESSION_EXPIRY_ALARM, { when: atMs });
      } catch {
        pending = null;
      }
    },
  };
};
