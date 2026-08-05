/**
 * Keeps the privacy disclosure fresh while a registration waits on the privacy
 * indexer.
 *
 * Starknet accepts a registration well before the indexer reflects it, so a
 * disclosure read in that window reports a state the user has already moved
 * past. This owns one scheduler for exactly that window: it starts when a
 * pending registration appears, re-reads on a short burst and then a steady
 * tick, and stops the moment the reading settles either way. The scheduler
 * underneath is single-flight and visibility-gated, so a hidden panel does no
 * work and a slow read never stacks.
 *
 * The re-read is deliberately quiet — it replaces the disclosure value in place
 * rather than clearing it first, so private balances already on screen do not
 * blink to "Discovering…" on every tick.
 */

import type { PrivacyAccountState } from "./privacy-runtime";
import { createRefreshScheduler, type RefreshScheduler } from "./refresh-scheduler";

/** Dense while the indexer is most likely to catch up, then a steady tick. */
const PENDING_BURST_DELAYS_MS = [500, 1_500] as const;
const PENDING_POLL_INTERVAL_MS = 3_000;

/**
 * The disclosure re-read, its scope guard, and timers injected at the boundary.
 * `apply` is only called for a reading `stillCurrent` accepts, so an answer that
 * arrives after an account or network change is dropped rather than rendered.
 */
export type PendingRegistrationPollPort = {
  readonly apply: (state: PrivacyAccountState) => void;
  readonly clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  readonly load: () => Promise<PrivacyAccountState>;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly stillCurrent: (state: PrivacyAccountState) => boolean;
  readonly visible: () => boolean;
};

/**
 * Poll handle. `sync` is idempotent: call it with the latest reading on every
 * bind and the poll starts, keeps running, or stops to match.
 */
export type PendingRegistrationPoll = {
  readonly sync: (pending: boolean, port: PendingRegistrationPollPort) => void;
};

/**
 * Creates the pending-registration poll. Nothing runs until `sync(true, …)`.
 */
export const createPendingRegistrationPoll = (): PendingRegistrationPoll => {
  let scheduler: RefreshScheduler | null = null;
  // Visibility as the scheduler last saw it, recorded where the scheduler reads
  // it rather than where `sync` is called: a hidden surface stops repainting, so
  // `sync` is exactly what does not run during the window this has to detect.
  let seenVisible = true;
  return {
    sync(pending, port) {
      if (!pending) {
        scheduler?.stop();
        scheduler = null;
        seenVisible = true;
        return;
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
      seenVisible = true;
      scheduler = createRefreshScheduler({
        burstDelaysMs: PENDING_BURST_DELAYS_MS,
        ...(port.clearTimer ? { clearTimer: port.clearTimer } : {}),
        pollIntervalMs: PENDING_POLL_INTERVAL_MS,
        async refresh() {
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
      scheduler.start();
      scheduler.afterAction();
    },
  };
};
