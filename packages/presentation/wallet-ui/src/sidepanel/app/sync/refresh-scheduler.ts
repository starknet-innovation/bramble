/**
 * Visible-panel refresh scheduling for event, chain-confirmation, and ambient
 * state updates. Every refresh is single-flight; requests arriving while one
 * runs collapse into one follow-up instead of racing stale snapshots.
 */

export type RefreshScheduler = {
  /** Schedules one bounded reconciliation after an action. */
  readonly afterAction: () => void;
  /** Refreshes once without starting transaction-confirmation polling. */
  readonly refreshNow: () => void;
  /** Starts ambient polling while the wallet surface is visible. */
  readonly start: () => void;
  /** Cancels all timers when the surface is disposed. */
  readonly stop: () => void;
  /** Reconciles timers and refreshes after the surface becomes visible. */
  readonly visibilityChanged: () => void;
};

/** Why the visible surface is being refreshed. */
export type RefreshReason = "action" | "ambient" | "event";

/**
 * Timers, visibility state, cadence, and refresh work injected at the boundary.
 */
export type RefreshSchedulerOptions = {
  readonly burstDelaysMs?: readonly number[];
  readonly clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  readonly pollIntervalMs?: number;
  readonly refresh: (reason: RefreshReason) => Promise<void>;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly visible: () => boolean;
};

const DEFAULT_BURST_DELAYS_MS = [3_000] as const;
const DEFAULT_POLL_INTERVAL_MS = 60_000;

/**
 * Creates the adaptive side-panel polling loop. Hidden surfaces do no work,
 * action bursts reset rather than stack, and refresh failures remain retryable.
 */
export const createRefreshScheduler = ({
  burstDelaysMs = DEFAULT_BURST_DELAYS_MS,
  clearTimer = clearTimeout,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  refresh,
  setTimer = setTimeout,
  visible,
}: RefreshSchedulerOptions): RefreshScheduler => {
  let generalTimer: ReturnType<typeof setTimeout> | null = null;
  let burstTimers: readonly ReturnType<typeof setTimeout>[] = [];
  let running = false;
  let queued: RefreshReason | null = null;
  let stopped = true;

  const clearGeneral = (): void => {
    if (generalTimer !== null) {
      clearTimer(generalTimer);
      generalTimer = null;
    }
  };

  const clearBurst = (): void => {
    for (const timer of burstTimers) {
      clearTimer(timer);
    }
    burstTimers = [];
  };

  const scheduleGeneral = (): void => {
    clearGeneral();
    if (stopped || !visible()) {
      return;
    }
    generalTimer = setTimer(() => {
      generalTimer = null;
      void run("ambient");
    }, pollIntervalMs);
  };

  const run = async (reason: RefreshReason): Promise<void> => {
    if (stopped || !visible()) {
      scheduleGeneral();
      return;
    }
    if (running) {
      queued = reason === "action" || queued === null ? reason : queued;
      return;
    }
    running = true;
    try {
      await refresh(reason);
    } catch {
      // Polling is best-effort; the next event or interval retries.
    } finally {
      running = false;
      if (queued !== null) {
        const next = queued;
        queued = null;
        void run(next);
      } else {
        scheduleGeneral();
      }
    }
  };

  return {
    afterAction() {
      clearGeneral();
      clearBurst();
      burstTimers = burstDelaysMs.map((delayMs) =>
        setTimer(() => {
          void run("action");
        }, delayMs),
      );
    },
    refreshNow() {
      clearGeneral();
      void run("event");
    },
    start() {
      stopped = false;
      scheduleGeneral();
    },
    stop() {
      stopped = true;
      queued = null;
      clearGeneral();
      clearBurst();
    },
    visibilityChanged() {
      if (!visible()) {
        clearGeneral();
        clearBurst();
        return;
      }
      void run("ambient");
    },
  };
};
