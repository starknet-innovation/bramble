/**
 * Keeps a Quantum-safe Bitcoin account screen fresh while one of its deposits
 * is on its way (waiting or sent): it re-reads the vaults about once a minute
 * while the panel is visible, and stops when nothing is in flight, when the
 * panel is hidden, and for good when the screen is left.
 *
 * The scheduler underneath is the panel's own: single-flight, so a slow read
 * never stacks, and visibility-gated, so a hidden panel does no work. Coming
 * back into view re-reads at once. Timers are injected at the boundary.
 */
import { createRefreshScheduler, type RefreshScheduler } from "../../app/sync/refresh-scheduler";
import type { StageTimers } from "../../shared/stage-pacer";

/** About a minute between reads while a deposit is in flight. */
export const QSB_VAULT_POLL_MS = 60_000;

/** What the poll drives: the quiet re-read, the document whose visibility gates it, timers. */
export type QsbVaultPollDeps = {
  readonly doc: Document;
  readonly read: () => Promise<void>;
  readonly timers: StageTimers;
};

/** The poll handle: `sync` matches it to the latest reading; `stop` ends it for good. */
export type QsbVaultPoll = {
  readonly stop: () => void;
  readonly sync: (inFlight: boolean) => void;
};

/**
 * Creates the poll. Nothing runs until `sync(true)`; `sync(false)` stops it
 * and a later `sync(true)` starts it again. After `stop`, `sync` does nothing.
 */
export const createQsbVaultPoll = ({ doc, read, timers }: QsbVaultPollDeps): QsbVaultPoll => {
  let scheduler: RefreshScheduler | null = null;
  let ended = false;
  const visible = (): boolean => doc.visibilityState === "visible";
  const onVisibility = (): void => scheduler?.visibilityChanged();

  const halt = (): void => {
    scheduler?.stop();
    scheduler = null;
    doc.removeEventListener("visibilitychange", onVisibility);
  };

  return {
    stop: () => {
      ended = true;
      halt();
    },
    sync: (inFlight) => {
      if (ended || !inFlight) {
        halt();
        return;
      }
      if (scheduler) return;
      scheduler = createRefreshScheduler({
        burstDelaysMs: [],
        clearTimer: timers.clear,
        pollIntervalMs: QSB_VAULT_POLL_MS,
        refresh: read,
        setTimer: timers.set,
        visible,
      });
      doc.addEventListener("visibilitychange", onVisibility);
      scheduler.start();
    },
  };
};
