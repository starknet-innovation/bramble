/**
 * Wall-clock budgets on the waits inside a private proof.
 *
 * The SDK's discovery and proving fetches take no signal, and the maturity poll
 * was bounded by count alone, so a wait that kept answering "not yet" parked
 * the job with nothing to report. Each wait now runs under a budget; these pin
 * the primitive (a lapse rejects with the phase's reason, a settled wait
 * releases its timer, a lapsed timer never surfaces as an unhandled rejection)
 * and the maturity runtime's use of it (a wall-clock bound independent of the
 * poll count, with the loop stopping once the race is lost).
 */
import { describe, expect, test } from "bun:test";
import {
  isStrk20WaitExceeded,
  openStrk20WaitBudget,
  STRK20_PROVER_REQUEST,
  STRK20_WAIT_BUDGETS,
  type WaitScheduler,
  withinStrk20WaitBudget,
} from "@bramble/privacy/official-sdk-budget";
import { createStrk20MaturityRuntime } from "@bramble/privacy/official-sdk-maturity";
import type { RpcProvider } from "starknet";

const manualScheduler = () => {
  const timers: { cancelled: boolean; delayMs: number; tick: () => void }[] = [];
  const schedule: WaitScheduler = (tick, delayMs) => {
    const entry = { cancelled: false, delayMs, tick };
    timers.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  return { schedule, timers };
};

describe("wait budget", () => {
  test("resolves with the work and releases the timer when the work settles first", async () => {
    const { schedule, timers } = manualScheduler();
    await expect(
      withinStrk20WaitBudget("proving", 1_000, () => Promise.resolve("proof"), schedule),
    ).resolves.toBe("proof");
    expect(timers).toEqual([{ cancelled: true, delayMs: 1_000, tick: expect.any(Function) }]);
  });

  test("rejects with the phase's reason once the budget lapses", async () => {
    const { schedule, timers } = manualScheduler();
    const pending = withinStrk20WaitBudget(
      "discovering private notes",
      60_000,
      () => new Promise<never>(() => undefined),
      schedule,
    );
    timers[0]?.tick();
    await expect(pending).rejects.toThrow(
      "strk20 services unavailable: discovering private notes did not finish within 60 s",
    );
    await pending.catch((error: unknown) => {
      expect(isStrk20WaitExceeded(error)).toBe(true);
    });
    expect(isStrk20WaitExceeded(new Error("did not finish within 60 s"))).toBe(false);
  });

  test("marks itself expired for a polling loop and never leaks a rejection", async () => {
    const { schedule, timers } = manualScheduler();
    const budget = openStrk20WaitBudget("waiting for pool maturity", 5, schedule);
    expect(budget.expired()).toBe(false);
    timers[0]?.tick();
    expect(budget.expired()).toBe(true);
    // Nobody raced against `expiry`; the pre-attached handler keeps the lapse
    // from becoming an unhandled rejection. Awaiting it here just confirms the
    // reason it carries.
    await expect(budget.expiry).rejects.toThrow("waiting for pool maturity");
    budget.release();
  });

  test("keeps the prover's own budget inside the proving budget", () => {
    const { requestTimeoutMs, retries } = STRK20_PROVER_REQUEST;
    // Four attempts of the request deadline plus the SDK's 1 + 2 + 4 s backoff.
    expect(requestTimeoutMs * (retries + 1) + 7_000).toBeLessThan(STRK20_WAIT_BUDGETS.proving);
  });
});

describe("maturity wait under a budget", () => {
  const provider = (latest: number, ready: boolean) =>
    ({
      callContract: async () => ["0x0", ready ? "0x10" : "0x0"],
      getBlockNumber: async () => latest,
      getClassHashAt: async () => "0xdef",
    }) as unknown as RpcProvider;
  const scope = { accountId: "SN_MAIN:0xabc", networkId: "SN_MAIN" as const, poolAddress: "0x1" };

  test("returns the proving block without touching the budget when state is ready", async () => {
    const { schedule, timers } = manualScheduler();
    const maturity = createStrk20MaturityRuntime({ maturityBudgetMs: 1_000, schedule });
    await expect(maturity.provingBlock(provider(20, true), scope)).resolves.toBe(10);
    expect(timers[0]?.cancelled).toBe(true);
  });

  test("fails with the phase's reason when the budget lapses before the state matures", async () => {
    const { schedule, timers } = manualScheduler();
    let polls = 0;
    const maturity = createStrk20MaturityRuntime({
      maturityBudgetMs: 300_000,
      pause: async () => {
        polls += 1;
        // The node keeps answering "not yet"; the wall clock, not the poll
        // count, is what ends the wait.
        if (polls === 3) timers[0]?.tick();
      },
      schedule,
    });
    await expect(
      maturity.provingBlock(provider(20, false), scope, async () => false),
    ).rejects.toThrow(
      "strk20 services unavailable: waiting for pool maturity did not finish within 300 s",
    );
    // The loop read the lapsed budget and stopped rather than spending the
    // remaining hundred-odd polls on a wait already called off.
    expect(polls).toBe(3);
  });
});
