/**
 * A manual clock for the stage pacer's timer seam: nothing fires until a test
 * advances time, so a test can assert exactly what is on screen at each instant
 * of a paced progress takeover without sleeping.
 */
import type { StageTimers } from "../../src/sidepanel/shared/stage-pacer";

type Task = { readonly at: number; readonly id: number; readonly task: () => void };

export type ManualTimers = StageTimers & {
  /** Moves the clock forward, running every task that falls due in order. */
  readonly advance: (ms: number) => void;
  /** Runs every pending task, however far ahead, in due order. */
  readonly flush: () => void;
  readonly now: () => number;
  readonly pending: () => number;
};

export const manualTimers = (): ManualTimers => {
  let now = 0;
  let nextId = 1;
  let tasks: Task[] = [];
  const runUntil = (limit: number): void => {
    for (;;) {
      const due = tasks
        .filter((entry) => entry.at <= limit)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      tasks = tasks.filter((entry) => entry !== due);
      now = Math.max(now, due.at);
      due.task();
    }
    if (Number.isFinite(limit)) now = Math.max(now, limit);
  };
  return {
    advance: (ms) => runUntil(now + ms),
    clear: (handle) => {
      tasks = tasks.filter((entry) => entry.id !== (handle as unknown as number));
    },
    flush: () => runUntil(Number.POSITIVE_INFINITY),
    now: () => now,
    pending: () => tasks.length,
    set: (task, ms) => {
      const id = nextId;
      nextId += 1;
      tasks.push({ at: now + ms, id, task });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
  };
};
