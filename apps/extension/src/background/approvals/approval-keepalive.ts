/**
 * Holds the MV3 worker open while a user decision is pending (#350).
 *
 * A dapp-triggered prompt parks the caller's response in memory until the user
 * answers it: both the approval queue and the registry of held responses are
 * intentionally never persisted, so a suspension loses the prompt and every
 * held response with it. Chromium keeps
 * a service worker alive for a pending `sendResponse`; a Firefox event page is
 * torn down on its idle timer regardless, and the only thing that resets that
 * timer is an extension (parent) API call. This controller makes one such call
 * every {@link APPROVAL_KEEPALIVE_MS} exactly while an approval or a parked
 * response is pending, and cancels the interval as soon as none is, so no timer
 * outlives the state it protects.
 *
 * Trust boundary: it reads only the injected `isPending` probe, which is a
 * pending-count question over two in-memory registries, and never touches key
 * material, a caller's payload, or a storage boundary. Failure behaviour: the
 * probe must not throw (it is a count over two maps), and an absent `keepAlive`
 * means no interval is scheduled at all, so a runtime without the API call
 * falls back to the open surface's own activity exactly as the STRK20 job
 * registry does without one.
 */

/**
 * How often the controller calls back while something is pending. Firefox's
 * event-page idle timer is around 30 seconds, and Chrome's service-worker
 * timeout is 30 seconds; a call every 20 seconds is the cadence both lifecycle
 * documents describe for holding a worker open, and the cadence the STRK20 job
 * registry already uses.
 */
export const APPROVAL_KEEPALIVE_MS = 20_000;

/**
 * Collaborators of the controller. Every timer is injected so the cadence and
 * its cancellation stay deterministic under test.
 */
export type ApprovalKeepAliveOptions = {
  /**
   * Whether an approval or a parked response is still awaiting a decision.
   * Read once per {@link ApprovalKeepAlive.sync} and once more on every tick,
   * so a state that clears between ticks stops the interval without a second
   * signal from the caller.
   */
  readonly isPending: () => boolean;
  /**
   * Extension API touch that resets the worker's idle timer, e.g.
   * `chrome.runtime.getPlatformInfo`. Absent in tests and runtimes without one;
   * the controller then schedules nothing.
   */
  readonly keepAlive?: () => void;
  readonly intervalMs?: number;
  /** Interval scheduler; defaults to `setInterval` and returns its canceller. */
  readonly schedule?: (tick: () => void, intervalMs: number) => () => void;
};

/**
 * Starts and stops the pending-decision keepalive. Instance-scoped to one
 * worker; `sync` reconciles the interval with the current pending state.
 */
export type ApprovalKeepAlive = {
  /** Whether the interval is currently scheduled. */
  readonly active: () => boolean;
  /**
   * Starts the interval when something is pending and none runs yet, and stops
   * it when nothing is pending or no keepalive call is available. Idempotent,
   * so it is safe to call on every approval change.
   */
  readonly sync: () => void;
};

const defaultSchedule = (tick: () => void, intervalMs: number): (() => void) => {
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
};

/**
 * Creates the pending-decision keepalive controller. Call {@link
 * ApprovalKeepAlive.sync} whenever the pending state may have changed; the
 * interval stops itself on the first tick that finds nothing pending.
 */
export const createApprovalKeepAlive = (options: ApprovalKeepAliveOptions): ApprovalKeepAlive => {
  const intervalMs = options.intervalMs ?? APPROVAL_KEEPALIVE_MS;
  const schedule = options.schedule ?? defaultSchedule;
  const keepAlive = options.keepAlive;
  let cancel: (() => void) | null = null;

  const stop = (): void => {
    if (cancel) {
      cancel();
      cancel = null;
    }
  };

  const tick = (): void => {
    if (!options.isPending()) {
      stop();
      return;
    }
    keepAlive?.();
  };

  return {
    active: () => cancel !== null,
    sync() {
      if (!keepAlive || !options.isPending()) {
        stop();
        return;
      }
      if (!cancel) {
        cancel = schedule(tick, intervalMs);
      }
    },
  };
};
