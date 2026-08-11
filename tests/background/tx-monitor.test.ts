/**
 * Background cadence wiring. The MV3 worker is terminated when idle, so these
 * assertions pin that reconciliation is scheduled through `chrome.alarms` (two
 * cadences, correct periods) rather than a timer, that an unknown alarm is
 * ignored, and that a runtime without the alarms API degrades quietly instead
 * of throwing on worker start.
 */
import { describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { memoryActivityLog } from "@mc-wallet/transactions/activity";
import {
  type AlarmsApi,
  startTransactionMonitor,
} from "../../apps/extension/src/background/tx-monitor";
import {
  FAST_OBSERVATION_PERIOD_MINUTES,
  SLOW_OBSERVATION_PERIOD_MINUTES,
} from "../../apps/extension/src/background/tx-observation";
import type { ReconcileDeps } from "../../apps/extension/src/background/tx-reconcile";

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [],
};
const storageReady = Promise.resolve();

// `existing` seeds alarms the browser already has, so a test can distinguish a
// fresh worker from one restarting with its schedule intact.
const makeAlarms = (existing: readonly string[] = []) => {
  const live = new Set(existing);
  const created: { readonly name: string; readonly periodInMinutes: number }[] = [];
  let listener: ((alarm: { readonly name: string }) => void) | null = null;
  const alarms: AlarmsApi = {
    create(name, info) {
      live.add(name);
      created.push({ name, periodInMinutes: info.periodInMinutes });
    },
    async get(name) {
      return live.has(name) ? { name } : undefined;
    },
    onAlarm: {
      addListener(next) {
        listener = next;
      },
    },
  };
  return { alarms, created, fire: (name: string) => listener?.({ name }) };
};

const makeDeps = (): { readonly deps: ReconcileDeps; readonly reads: string[] } => {
  const reads: string[] = [];
  return {
    deps: {
      activity: memoryActivityLog(),
      preferencesStore: {
        async read() {
          reads.push("preferences");
          return preferences;
        },
      },
      runtimeRpc: {
        async getTransactionStatuses() {
          return {};
        },
      } as unknown as ReconcileDeps["runtimeRpc"],
    },
    reads,
  };
};

// Alarm creation is deferred behind an existence check, so it settles a couple
// of microtasks after the synchronous start call returns.
const scheduled = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("transaction monitor", () => {
  test("registers one alarm per cadence with its own period", async () => {
    const { alarms, created } = makeAlarms();
    const { deps } = makeDeps();
    expect(
      startTransactionMonitor({ browser: { alarms }, deps, now: () => 0, ready: storageReady }),
    ).toBe(true);
    await scheduled();
    expect(created).toEqual([
      { name: "mc-wallet:tx-observe-fast", periodInMinutes: FAST_OBSERVATION_PERIOD_MINUTES },
      { name: "mc-wallet:tx-observe-slow", periodInMinutes: SLOW_OBSERVATION_PERIOD_MINUTES },
    ]);
    expect(SLOW_OBSERVATION_PERIOD_MINUTES).toBeGreaterThan(FAST_OBSERVATION_PERIOD_MINUTES);
  });

  // An MV3 worker re-runs this module on every wake. Re-creating a live alarm
  // would restart its period, so a worker woken more often than once a minute
  // would keep pushing the fast alarm's deadline out and it would never fire.
  test("leaves an already-scheduled alarm alone when the worker restarts", async () => {
    const { alarms, created } = makeAlarms(["mc-wallet:tx-observe-fast"]);
    const { deps } = makeDeps();
    startTransactionMonitor({ browser: { alarms }, deps, now: () => 0, ready: storageReady });
    await scheduled();
    expect(created.map((alarm) => alarm.name)).toEqual(["mc-wallet:tx-observe-slow"]);
  });

  test("reconciles on a known alarm and ignores anything else", async () => {
    const { alarms, fire } = makeAlarms();
    const { deps } = makeDeps();
    startTransactionMonitor({ browser: { alarms }, deps, now: () => 0, ready: storageReady });
    fire("some-other-extension-alarm");
    fire("mc-wallet:tx-observe-fast");
    await Promise.resolve();
    // With no observed entries the reconciler short-circuits before any read,
    // so the assertion that matters is simply that neither call threw.
    expect((await deps.activity.list()).length).toBe(0);
  });

  test("registers synchronously but defers storage work until startup is secure", async () => {
    const { alarms, fire } = makeAlarms();
    const { deps } = makeDeps();
    const ready = Promise.withResolvers<void>();
    let activityReads = 0;
    const gated: ReconcileDeps = {
      ...deps,
      activity: {
        ...deps.activity,
        async list() {
          activityReads += 1;
          return [];
        },
      },
    };

    startTransactionMonitor({
      browser: { alarms },
      deps: gated,
      now: () => 0,
      ready: ready.promise,
    });
    fire("mc-wallet:tx-observe-fast");
    await scheduled();
    expect(activityReads).toBe(0);

    ready.resolve();
    await scheduled();
    expect(activityReads).toBe(1);
  });

  test("never touches storage when the startup security gate rejects", async () => {
    const { alarms, fire } = makeAlarms();
    const { deps } = makeDeps();
    const ready = Promise.withResolvers<void>();
    let activityReads = 0;
    const gated: ReconcileDeps = {
      ...deps,
      activity: {
        ...deps.activity,
        async list() {
          activityReads += 1;
          return [];
        },
      },
    };

    startTransactionMonitor({
      browser: { alarms },
      deps: gated,
      now: () => 0,
      ready: ready.promise,
    });
    fire("mc-wallet:tx-observe-fast");
    ready.reject(new Error("storage lockdown failed"));
    await scheduled();
    expect(activityReads).toBe(0);
  });

  test("serializes alarm reconciliation after readiness", async () => {
    const { alarms, fire } = makeAlarms();
    const { deps } = makeDeps();
    const releaseFirst = Promise.withResolvers<void>();
    let calls = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    const serialized: ReconcileDeps = {
      ...deps,
      activity: {
        ...deps.activity,
        async list() {
          calls += 1;
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          if (calls === 1) {
            await releaseFirst.promise;
          }
          concurrent -= 1;
          return [];
        },
      },
    };

    startTransactionMonitor({
      browser: { alarms },
      deps: serialized,
      now: () => 0,
      ready: storageReady,
    });
    fire("mc-wallet:tx-observe-fast");
    fire("mc-wallet:tx-observe-slow");
    await scheduled();
    expect(calls).toBe(1);

    releaseFirst.resolve();
    await scheduled();
    await scheduled();
    expect(calls).toBe(2);
    expect(maxConcurrent).toBe(1);
  });

  test("swallows a failing reconcile so one bad tick cannot kill the schedule", async () => {
    const { alarms, fire } = makeAlarms();
    const { deps } = makeDeps();
    const failing: ReconcileDeps = {
      ...deps,
      activity: {
        ...deps.activity,
        async list() {
          throw new Error("storage unavailable");
        },
      },
    };
    startTransactionMonitor({
      browser: { alarms },
      deps: failing,
      now: () => 0,
      ready: storageReady,
    });
    expect(() => fire("mc-wallet:tx-observe-slow")).not.toThrow();
    await Promise.resolve();
  });

  // Scheduling happens at worker start, before anything can catch for us, so a
  // runtime whose alarms API rejects must degrade to "not scheduled" rather
  // than taking down the whole service worker on boot.
  test("survives an alarms API that cannot answer whether an alarm exists", async () => {
    const { alarms } = makeAlarms();
    const { deps } = makeDeps();
    const broken: AlarmsApi = {
      ...alarms,
      async get() {
        throw new Error("alarms unavailable");
      },
    };
    expect(
      startTransactionMonitor({
        browser: { alarms: broken },
        deps,
        now: () => 0,
        ready: storageReady,
      }),
    ).toBe(true);
    await scheduled();
  });

  test("reports not-scheduled when listener registration throws", () => {
    const { alarms, created } = makeAlarms();
    const { deps } = makeDeps();
    const broken: AlarmsApi = {
      ...alarms,
      onAlarm: {
        addListener() {
          throw new Error("listeners unavailable");
        },
      },
    };
    expect(
      startTransactionMonitor({
        browser: { alarms: broken },
        deps,
        now: () => 0,
        ready: storageReady,
      }),
    ).toBe(false);
    expect(created).toEqual([]);
  });

  test("reports not-scheduled when the runtime exposes no alarms", () => {
    const { deps } = makeDeps();
    expect(
      startTransactionMonitor({ browser: undefined, deps, now: () => 0, ready: storageReady }),
    ).toBe(false);
    expect(startTransactionMonitor({ browser: {}, deps, now: () => 0, ready: storageReady })).toBe(
      false,
    );
  });
});
