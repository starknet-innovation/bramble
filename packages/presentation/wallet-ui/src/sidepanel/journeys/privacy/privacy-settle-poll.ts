/**
 * Keeps the private-balance disclosure fresh after a private operation settles.
 *
 * Starknet accepts a shield, an unshield, or a private send well before the
 * privacy indexer reflects the moved note, so a disclosure read inside that
 * window reports the balance the user has already moved past: the home
 * portfolio then looks unchanged and shows no shielded status, which reads as
 * "the shield did nothing". The registration poll covers a pending
 * registration; this is its sibling for a settled value move.
 *
 * It re-reads on the same short burst and steady tick, replaces the reading in
 * place so balances already on screen never blink to "Discovering…", and stops
 * itself once a bounded window has passed so a slow or silent indexer cannot
 * poll forever. The scheduler underneath is single-flight and visibility-gated,
 * so a hidden panel does no work and a slow read never stacks.
 */

import { createRefreshScheduler, type RefreshScheduler } from "../../app/sync/refresh-scheduler";
import type { PrivacyAccountState } from "./privacy-runtime";

/** Dense while the indexer is most likely to catch the note, then a steady tick. */
const SETTLE_BURST_DELAYS_MS = [500, 1_500] as const;
const SETTLE_POLL_INTERVAL_MS = 3_000;
/**
 * How long a settled move is watched. The privacy service lags the chain by
 * seconds to minutes, so a bounded window is enough to show the settled
 * balance; past it the reading is left as it stands and the ordinary refresh
 * controls take over.
 */
const SETTLE_WINDOW_MS = 120_000;

/**
 * The disclosure re-read, its scope guard, the bounded window, and timers
 * injected at the boundary. `apply` is only called for a reading `stillCurrent`
 * accepts, so an answer that arrives after an account or network change is
 * dropped rather than rendered.
 */
type PrivateSettlePollPort = {
  readonly apply: (state: PrivacyAccountState) => void;
  readonly clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  readonly load: () => Promise<PrivacyAccountState>;
  /**
   * Wall clock, injected so the bounded window is deterministic under test.
   * Without it the poll cannot measure its window and refuses to arm.
   */
  readonly now?: () => number;
  /**
   * Called when the poll observes that its bounded window has closed: once as
   * the armed watch tears itself down, and again on a later repaint that still
   * carries the settling time, until the caller drops it. Not called when
   * `sync` is handed null to begin with.
   */
  readonly onExpire?: () => void;
  readonly scopeKey: string;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly stillCurrent: (state: PrivacyAccountState) => boolean;
  readonly visible: () => boolean;
};

/**
 * Settle-poll handle. `sync` is idempotent: pass the settling operation's start
 * time while it is in its window, and null once none is.
 */
export type PrivateSettlePoll = {
  readonly sync: (settledAt: number | null, port: PrivateSettlePollPort) => void;
};

/**
 * Creates the settled-move poll. Nothing runs until `sync(settledAt, …)` with a
 * non-null time.
 */
export const createPrivateSettlePoll = (windowMs: number = SETTLE_WINDOW_MS): PrivateSettlePoll => {
  let scheduler: RefreshScheduler | null = null;
  let schedulerScope: string | null = null;
  let watchingSince: number | null = null;
  // Visibility as the scheduler last saw it, recorded where the scheduler reads
  // it rather than where `sync` is called: a hidden surface stops repainting, so
  // `sync` is exactly what does not run during the window this has to detect.
  let seenVisible = true;
  const stop = (): void => {
    scheduler?.stop();
    scheduler = null;
    schedulerScope = null;
    watchingSince = null;
    seenVisible = true;
  };
  return {
    sync(settledAt, port) {
      const clock = port.now;
      if (settledAt === null || clock === undefined) {
        stop();
        return;
      }
      // The window is one-shot. Once it has closed the watch is over, but the
      // caller still holds the settling time (it is dropped only on a scope
      // change or a lock), so a later repaint calls back in with the same
      // value. Refuse it before arming: an expired window must not build a
      // scheduler whose first tick immediately tears it down.
      if (clock() - settledAt >= windowMs) {
        stop();
        port.onExpire?.();
        return;
      }
      if (scheduler && schedulerScope !== port.scopeKey) {
        stop();
      }
      if (scheduler) {
        // A tick that fired while hidden rescheduled nothing, leaving the poll
        // quiet. Re-arm on the way back, and only then: re-reading on every bind
        // would loop, because applying a reading repaints and a repaint binds.
        if (!seenVisible && port.visible()) {
          seenVisible = true;
          scheduler.visibilityChanged();
        }
        return;
      }
      watchingSince = settledAt;
      seenVisible = true;
      schedulerScope = port.scopeKey;
      // Own the new scheduler through a local. `start` and `visibilityChanged`
      // can run the refresh synchronously, and a window that closes at this
      // boundary stops the poll and nulls the shared handle before the next
      // call, so the calls below must not go through it.
      const armed = createRefreshScheduler({
        burstDelaysMs: SETTLE_BURST_DELAYS_MS,
        ...(port.clearTimer ? { clearTimer: port.clearTimer } : {}),
        pollIntervalMs: SETTLE_POLL_INTERVAL_MS,
        async refresh() {
          // The window is bounded: once it closes, the poll tears itself down so
          // a reading the indexer never delivers cannot poll indefinitely.
          if (watchingSince === null || clock() - watchingSince >= windowMs) {
            stop();
            port.onExpire?.();
            return;
          }
          const state = await port.load();
          if (port.stillCurrent(state)) {
            port.apply(state);
          }
        },
        ...(port.setTimer ? { setTimer: port.setTimer } : {}),
        visible: () => {
          seenVisible = port.visible();
          return seenVisible;
        },
      });
      scheduler = armed;
      armed.start();
      armed.visibilityChanged();
      armed.afterAction();
    },
  };
};
