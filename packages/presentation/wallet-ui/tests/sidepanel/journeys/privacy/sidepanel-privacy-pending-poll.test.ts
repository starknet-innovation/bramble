/**
 * Pending-registration polling: it re-reads only while a registration is
 * unindexed, stops the moment the reading settles, and never applies an answer
 * that belongs to a scope the user has already left.
 */
import { describe, expect, test } from "bun:test";
import { createPendingRegistrationPoll } from "../../../../src/sidepanel/journeys/privacy/privacy-pending-poll";
import type { PrivacyAccountState } from "../../../../src/sidepanel/journeys/privacy/privacy-runtime";

type Timer = { readonly callback: () => void; readonly delayMs: number };

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const state = (registration: PrivacyAccountState["registration"]): PrivacyAccountState => ({
  accountId: "SN_MAIN:0xabc",
  balances: [],
  networkId: "SN_MAIN",
  poolFeeFri: "0x1",
  relayConfigured: true,
  registration,
});

const harness = (options: {
  readonly load: () => Promise<PrivacyAccountState>;
  readonly stillCurrent?: (value: PrivacyAccountState) => boolean;
}) => {
  let nextId = 1;
  let visible = true;
  const applied: PrivacyAccountState[] = [];
  const timers = new Map<number, Timer>();
  const poll = createPendingRegistrationPoll();
  const port = {
    apply: (value: PrivacyAccountState) => {
      applied.push(value);
    },
    clearTimer: (handle: ReturnType<typeof setTimeout>) => {
      timers.delete(handle as unknown as number);
    },
    load: options.load,
    scopeKey: "SN_MAIN:account-1:0",
    setTimer: (callback: () => void, delayMs: number) => {
      const id = nextId++;
      timers.set(id, { callback, delayMs });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    stillCurrent: options.stillCurrent ?? (() => true),
    visible: () => visible,
  };
  return {
    applied,
    count: (delayMs: number): number =>
      [...timers].filter(([, timer]) => timer.delayMs === delayMs).length,
    fire: (delayMs: number): void => {
      const match = [...timers].find(([, timer]) => timer.delayMs === delayMs);
      if (!match) {
        throw new Error(`missing ${delayMs}ms timer`);
      }
      timers.delete(match[0]);
      match[1].callback();
    },
    setVisible: (value: boolean) => {
      visible = value;
    },
    sync: (pending: boolean, scopeKey = port.scopeKey) => {
      poll.sync(pending, { ...port, scopeKey });
    },
    timers,
  };
};

describe("pending registration poll", () => {
  test("re-reads while pending and stops once the reading settles", async () => {
    let reads = 0;
    const test = harness({
      load: async () => {
        reads += 1;
        return state(reads > 2 ? "registered" : "pending");
      },
    });

    test.sync(true);
    await flush();
    // The burst hydrates immediately rather than waiting out the first delay.
    expect(reads).toBe(1);
    expect(test.applied.at(-1)?.registration).toBe("pending");

    test.fire(500);
    await flush();
    expect(reads).toBe(2);

    test.fire(1_500);
    await flush();
    expect(reads).toBe(3);
    expect(test.applied.at(-1)?.registration).toBe("registered");

    // A settled reading tears the poll down; nothing keeps ticking afterwards.
    test.sync(false);
    expect(test.timers.size).toBe(0);
  });

  test("stays a single poll across repeated syncs", async () => {
    let reads = 0;
    const test = harness({
      load: async () => {
        reads += 1;
        return state("pending");
      },
    });

    test.sync(true);
    await flush();
    test.sync(true);
    test.sync(true);
    await flush();

    // Applying a reading repaints, and a repaint binds again. If a bind re-read,
    // this pair would loop forever over the network; if it built a second
    // scheduler, the burst timers would double.
    expect(reads).toBe(1);
    expect(test.count(500)).toBe(1);
  });

  test("restarts with fresh callbacks when the account or network scope changes", async () => {
    let reads = 0;
    const test = harness({
      load: async () => {
        reads += 1;
        return state("pending");
      },
    });

    test.sync(true, "SN_MAIN:account-1:0");
    await flush();
    expect(reads).toBe(1);

    test.sync(true, "SN_SEPOLIA:account-2:1");
    await flush();

    // The old scheduler and its timers are replaced. Keeping it would retain
    // the first account's load/apply closures until the registration settled.
    expect(reads).toBe(2);
    expect(test.count(500)).toBe(1);
  });

  test("re-arms a poll that a tick left stranded while the surface was hidden", async () => {
    let reads = 0;
    const test = harness({
      load: async () => {
        reads += 1;
        return state("pending");
      },
    });

    test.sync(true);
    await flush();
    expect(reads).toBe(1);

    // Ticks firing while hidden reschedule nothing, so the poll goes quiet: the
    // ambient timer is dropped and the burst has nothing left to fire.
    expect(test.count(3_000)).toBe(1);
    test.setVisible(false);
    test.fire(500);
    test.fire(1_500);
    await flush();
    expect(test.timers.size).toBe(0);

    // Coming back must revive it rather than leave a pending registration with
    // nothing watching it.
    test.setVisible(true);
    test.sync(true);
    await flush();
    expect(reads).toBe(2);
    expect(test.timers.size).toBeGreaterThan(0);
  });

  test("drops a reading whose scope the user already left", async () => {
    const test = harness({
      load: async () => state("registered"),
      stillCurrent: () => false,
    });

    test.sync(true);
    await flush();

    expect(test.applied).toEqual([]);
  });

  test("survives a failing read and keeps polling", async () => {
    let reads = 0;
    const test = harness({
      load: async () => {
        reads += 1;
        if (reads === 1) {
          throw new Error("privacy service unavailable");
        }
        return state("pending");
      },
    });

    test.sync(true);
    await flush();
    expect(reads).toBe(1);
    expect(test.applied).toEqual([]);

    test.fire(500);
    await flush();
    expect(reads).toBe(2);
    expect(test.applied.at(-1)?.registration).toBe("pending");
  });
});
