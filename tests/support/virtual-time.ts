/**
 * Deterministic virtual time for suites that inject `now` and `sleep`.
 *
 * The clock moves only when every pending task is parked on a virtual timer,
 * and then straight to the earliest one, so a walk that would take minutes of
 * wall time settles in milliseconds with every timestamp exact.
 */

/** A virtual clock, its timer, and the driver that advances them. */
export type VirtualTime = {
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  /**
   * Settles `work`, advancing the clock to the next timer whenever nothing
   * else can run. Throws if `work` is still pending with no timer left.
   */
  readonly settle: <T>(work: Promise<T>) => Promise<T>;
};

const drainMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Starts a virtual clock at `start` milliseconds. */
export const createVirtualTime = (start = 0): VirtualTime => {
  let clock = start;
  const timers: { readonly at: number; readonly resolve: () => void }[] = [];
  return {
    now: () => clock,
    sleep: (milliseconds) =>
      new Promise((resolve) => {
        timers.push({ at: clock + Math.max(0, milliseconds), resolve });
      }),
    settle: async (work) => {
      let settled = false;
      const outcome = work.finally(() => {
        settled = true;
      });
      // Observed here so a rejection is not reported as unhandled while the
      // loop below is still advancing; the caller sees it on the return.
      outcome.catch(() => undefined);
      for (;;) {
        await drainMicrotasks();
        if (settled) return outcome;
        timers.sort((left, right) => left.at - right.at);
        const next = timers[0];
        if (next === undefined) throw new Error("virtual time stalled with no pending timer");
        clock = Math.max(clock, next.at);
        const due = timers.filter((timer) => timer.at <= clock);
        timers.splice(0, due.length);
        for (const timer of due) timer.resolve();
      }
    },
  };
};
