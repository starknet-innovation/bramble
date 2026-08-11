/**
 * Adaptive refresh scheduling: ambient polling pauses while hidden, action
 * bursts reset, and overlapping ticks collapse behind one in-flight refresh.
 */
import { describe, expect, test } from "bun:test";
import { createRefreshScheduler } from "../../../../src/sidepanel/app/sync/refresh-scheduler";

type Timer = { readonly callback: () => void; readonly delayMs: number };

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const harness = (refresh: () => Promise<void>, initiallyVisible = true) => {
  let nextId = 1;
  let visible = initiallyVisible;
  const timers = new Map<number, Timer>();
  const scheduler = createRefreshScheduler({
    burstDelaysMs: [10, 20],
    clearTimer: (handle) => {
      timers.delete(handle as unknown as number);
    },
    pollIntervalMs: 100,
    refresh,
    setTimer: (callback, delayMs) => {
      const id = nextId++;
      timers.set(id, { callback, delayMs });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    visible: () => visible,
  });
  const fire = (delayMs: number): void => {
    const match = [...timers].find(([, timer]) => timer.delayMs === delayMs);
    if (!match) {
      throw new Error(`missing ${delayMs}ms timer`);
    }
    timers.delete(match[0]);
    match[1].callback();
  };
  return {
    fire,
    scheduler,
    setVisible: (value: boolean) => {
      visible = value;
    },
    timers,
  };
};

describe("refresh scheduler", () => {
  test("polls visibly and wakes immediately when a hidden surface returns", async () => {
    let refreshes = 0;
    const test = harness(async () => {
      refreshes += 1;
    }, false);

    test.scheduler.start();
    expect(test.timers.size).toBe(0);
    test.setVisible(true);
    test.scheduler.visibilityChanged();
    await flush();
    expect(refreshes).toBe(1);
    expect([...test.timers.values()].some((timer) => timer.delayMs === 100)).toBe(true);
  });

  test("hydrates once for an event received while hidden", async () => {
    let refreshes = 0;
    const test = harness(async () => {
      refreshes += 1;
    }, false);

    test.scheduler.start();
    test.scheduler.afterAction();
    await flush();

    expect(refreshes).toBe(1);
    expect([...test.timers.values()].map((timer) => timer.delayMs)).toEqual([10, 20]);
  });

  test("collapses overlapping action ticks into one follow-up refresh", async () => {
    let refreshes = 0;
    const refreshGates: (() => void)[] = [];
    const test = harness(
      () =>
        new Promise<void>((resolve) => {
          refreshes += 1;
          refreshGates.push(resolve);
        }),
    );
    test.scheduler.start();
    test.scheduler.afterAction();

    test.fire(10);
    test.fire(20);
    expect(refreshes).toBe(1);
    refreshGates[0]?.();
    await flush();
    expect(refreshes).toBe(2);

    refreshGates[1]?.();
    await flush();
    test.scheduler.stop();
    expect(test.timers.size).toBe(0);
  });
});
