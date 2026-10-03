/**
 * Pending-registration polling: it re-reads only while a registration is
 * unindexed, stops the moment the reading settles, and never applies an answer
 * that belongs to a scope the user has already left.
 */
import { describe, expect, test } from "bun:test";
import type { PrivacyAccountState } from "../../../../src/sidepanel/journeys/privacy/privacy-runtime";
import { createPrivateSettlePoll } from "../../../../src/sidepanel/journeys/privacy/privacy-settle-poll";

type Timer = { readonly callback: () => void; readonly delayMs: number };

const flush = async (): Promise<void> => {
  for (let step = 0; step < 6; step += 1) {
    await Promise.resolve();
  }
};

const state = (balance: string): PrivacyAccountState => ({
  accountId: "SN_MAIN:0xabc",
  balances: [
    {
      balance,
      formatted: balance,
      symbol: "ETH",
      token: "0x1",
      tokenId: "SN_MAIN:ETH:0x1",
    },
  ],
  networkId: "SN_MAIN",
  poolFeeFri: "0x1",
  relayConfigured: true,
  registration: "registered",
});

const harness = (options: {
  readonly load: () => Promise<PrivacyAccountState>;
  readonly stillCurrent?: (value: PrivacyAccountState) => boolean;
  readonly windowMs?: number;
}) => {
  let nextId = 1;
  let visible = true;
  let now = 0;
  const applied: PrivacyAccountState[] = [];
  const timers = new Map<number, Timer>();
  const poll =
    options.windowMs === undefined
      ? createPrivateSettlePoll()
      : createPrivateSettlePoll(options.windowMs);
  const port = {
    apply: (value: PrivacyAccountState) => {
      applied.push(value);
    },
    clearTimer: (handle: ReturnType<typeof setTimeout>) => {
      timers.delete(handle as unknown as number);
    },
    load: options.load,
    now: () => now,
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
    advance: (ms: number) => {
      now += ms;
    },
    sync: (settledAt: number | null, scopeKey = port.scopeKey) => {
      poll.sync(settledAt, { ...port, scopeKey });
    },
    timers,
  };
};

describe("private settle poll", () => {
  test("re-reads across the burst so a settled balance appears", async () => {
    let reads = 0;
    const test = harness({
      load: async () => {
        reads += 1;
        return state(reads < 3 ? "0" : "5");
      },
    });

    test.sync(0);
    await flush();
    // The burst hydrates immediately rather than waiting out the first delay.
    expect(reads).toBe(1);
    expect(test.applied.at(-1)?.balances[0]?.balance).toBe("0");

    test.fire(500);
    await flush();
    expect(reads).toBe(2);

    test.fire(1_500);
    await flush();
    expect(reads).toBe(3);
    // The indexer's later answer replaces the stale reading in place.
    expect(test.applied.at(-1)?.balances[0]?.balance).toBe("5");
  });

  test("stays a single poll across repeated syncs", async () => {
    let reads = 0;
    const test = harness({
      load: async () => {
        reads += 1;
        return state("0");
      },
    });

    test.sync(0);
    await flush();
    test.sync(0);
    test.sync(0);
    await flush();

    // Applying a reading repaints, and a repaint binds again. If a bind started
    // a second scheduler, the burst timers would double.
    expect(reads).toBe(1);
    expect(test.count(500)).toBe(1);
  });

  test("restarts with fresh callbacks when the account or network scope changes", async () => {
    let reads = 0;
    const test = harness({
      load: async () => {
        reads += 1;
        return state("0");
      },
    });

    test.sync(0, "SN_MAIN:account-1:0");
    await flush();
    expect(reads).toBe(1);

    test.sync(0, "SN_SEPOLIA:account-2:1");
    await flush();

    expect(reads).toBe(2);
    expect(test.count(500)).toBe(1);
  });

  test("stops once the bounded window has passed", async () => {
    let reads = 0;
    const test = harness({
      load: async () => {
        reads += 1;
        return state("0");
      },
      windowMs: 4_000,
    });

    test.sync(0);
    await flush();
    expect(reads).toBe(1);

    // Past the window the next tick tears the poll down without reading again,
    // so a reading the indexer never delivers cannot poll indefinitely.
    test.advance(5_000);
    test.fire(500);
    await flush();
    expect(reads).toBe(1);
    expect(test.timers.size).toBe(0);
  });

  test("tears down when no operation is being watched", async () => {
    let reads = 0;
    const test = harness({
      load: async () => {
        reads += 1;
        return state("0");
      },
    });

    test.sync(0);
    await flush();
    expect(reads).toBe(1);
    expect(test.timers.size).toBeGreaterThan(0);

    test.sync(null);
    expect(test.timers.size).toBe(0);
  });

  test("resumes a hidden poll with its pending action priority", async () => {
    let reads = 0;
    const test = harness({
      load: async () => {
        reads += 1;
        return state("0");
      },
    });

    test.sync(0);
    await flush();
    expect(reads).toBe(1);

    // Hidden ticks perform no reads. The last burst timer may remain armed, but
    // the scheduler preserves one pending action rather than losing it.
    expect(test.count(3_000)).toBe(1);
    test.setVisible(false);
    test.fire(500);
    test.fire(1_500);
    await flush();
    expect(reads).toBe(1);

    test.setVisible(true);
    test.sync(0);
    await flush();
    expect(reads).toBe(2);
    expect(test.timers.size).toBeGreaterThan(0);
  });

  test("drops a reading whose scope the user already left", async () => {
    const test = harness({
      load: async () => state("5"),
      stillCurrent: () => false,
    });

    test.sync(0);
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
        return state("5");
      },
    });

    test.sync(0);
    await flush();
    expect(reads).toBe(1);
    expect(test.applied).toEqual([]);

    test.fire(500);
    await flush();
    expect(reads).toBe(2);
    expect(test.applied.at(-1)?.balances[0]?.balance).toBe("5");
  });
});
