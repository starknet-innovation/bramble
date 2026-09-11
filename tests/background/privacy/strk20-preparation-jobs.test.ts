/**
 * A private proof outlives one runtime request, so it runs as a tracked job.
 *
 * Reported from a registered mainnet wallet: "Build private proof" never
 * resolved, and the panel later logged Chrome's "A listener indicated an
 * asynchronous response by returning true, but the message channel closed
 * before a response was received" — the worker was stopped while the proof was
 * still riding the request that started it. These pin the job registry itself
 * and the shield route on top of it: the start request answers at once with a
 * job the panel can poll, every poll carries the job's phase and elapsed time,
 * the outcome is what the poll settles on, the worker is held open while a job
 * runs, and a job a restarted worker never saw is refused with a reason
 * instead of polled forever. The activation and execution routes ride the same
 * registry; see ./strk20-execution-jobs.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { isStrk20JobId } from "@bramble/core/ids";
import type { Strk20Service } from "@bramble/privacy/service";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import {
  createStrk20JobRegistry,
  STRK20_JOB_INTERRUPTED,
  STRK20_JOB_KEEPALIVE_MS,
} from "../../../apps/extension/src/background/privacy/strk20-preparation-jobs";
import type { RuntimeResponse } from "../../../apps/extension/src/background/runtime/runtime-types";
import { account } from "../../support/background-wallet-stub";
import { flushHeld } from "../../support/held";
import {
  buildStrk20Handler,
  executeStrk20Preparation,
  makeStrk20Service,
  prepareStrk20Deposit,
  STRK20_EXTENSION_SENDER,
  STRK20_TOKEN,
  strk20RunningJobId,
} from "../../support/strk20-background";

const deferred = <T>(): {
  readonly promise: Promise<T>;
  readonly reject: (error: Error) => void;
  readonly resolve: (value: T) => void;
} => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
};

const scheduler = () => {
  const intervals: { cancelled: boolean; intervalMs: number; tick: () => void }[] = [];
  return {
    intervals,
    schedule: (tick: () => void, intervalMs: number): (() => void) => {
      const entry = { cancelled: false, intervalMs, tick };
      intervals.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  };
};

type DiagnosticRow = readonly [string, string, string, number];

const recorder = () => {
  const rows: DiagnosticRow[] = [];
  return {
    diagnostics: (kind: string, phase: string, outcome: string, durationMs: number) => {
      rows.push([kind, phase, outcome, durationMs]);
    },
    rows,
  };
};

const ok = { ok: true } as const;

describe("job registry", () => {
  test("answers a start at once, reports running, then the work's own reply", async () => {
    const work = deferred<RuntimeResponse>();
    const registry = createStrk20JobRegistry({ now: () => 1_700_000_000_000 });

    const started = registry.start("deposit", () => work.promise);
    expect(started.ok).toBe(true);
    expect(isStrk20JobId(started.strk20Job.id)).toBe(true);
    expect(started.strk20Job).toEqual({
      elapsedMs: 0,
      id: started.strk20Job.id,
      state: "running",
    });
    expect(registry.status(started.strk20Job.id)).toEqual(started);
    expect(registry.active()).toBe(true);

    work.resolve({ error: "Not enough STRK for the amount and pool fee" });
    await flushHeld();
    expect(registry.status(started.strk20Job.id)).toEqual({
      error: "Not enough STRK for the amount and pool fee",
    });
    expect(registry.active()).toBe(false);
  });

  test("carries the phase the work last reported and the elapsed time on every poll", async () => {
    let clock = 1_000;
    const { diagnostics, rows } = recorder();
    const registry = createStrk20JobRegistry({ diagnostics, now: () => clock });
    const work = deferred<RuntimeResponse>();
    let report: Parameters<Parameters<typeof registry.start>[1]>[0] = () => undefined;
    const started = registry.start("deposit", (sink) => {
      report = sink;
      return work.promise;
    });
    const id = started.strk20Job.id;

    // No phase yet: the envelope carries only the clock.
    clock = 1_500;
    expect(registry.status(id)).toEqual({
      ok: true,
      strk20Job: { elapsedMs: 500, id, state: "running" },
    });
    report({ phase: "checking registration" });
    clock = 4_000;
    expect(registry.status(id)).toEqual({
      ok: true,
      strk20Job: { elapsedMs: 3_000, id, phase: "checking registration", state: "running" },
    });
    // A bounded retry round rides along as two small integers.
    report({ attempt: 2, attempts: 3, phase: "proving" });
    clock = 9_000;
    expect(registry.status(id)).toEqual({
      ok: true,
      strk20Job: {
        attempt: 2,
        attempts: 3,
        elapsedMs: 8_000,
        id,
        phase: "proving",
        state: "running",
      },
    });
    // A label outside the fixed vocabulary never reaches the envelope.
    report({ phase: "leaking 0xabc" as never });
    expect(registry.status(id)).toMatchObject({ strk20Job: { phase: "proving" } });

    work.resolve({ error: "strk20 services unavailable: proving did not finish within 180 s" });
    await flushHeld();
    // Each phase closes with its duration; the run closes with its outcome
    // class, derived from the reason's shape and never carrying its text.
    expect(rows).toEqual([
      ["deposit", "checking registration", "ok", 2_500],
      ["deposit", "proving", "timeout", 5_000],
      ["deposit", "job", "timeout", 8_000],
    ]);
  });

  test("classifies settled outcomes without retaining their text", async () => {
    const { diagnostics, rows } = recorder();
    const registry = createStrk20JobRegistry({ diagnostics, now: () => 1 });
    for (const response of [
      { ok: true, transactionHash: "0x1" },
      { error: "wallet locked" },
      { error: "strk20 services unavailable: no privacy runtime is wired in this build" },
      { error: "Not enough private ETH" },
    ] as const) {
      registry.start("execute", () => Promise.resolve(response));
    }
    await flushHeld();
    expect(rows.map(([, , outcome]) => outcome)).toEqual(["ok", "locked", "unavailable", "error"]);
    expect(JSON.stringify(rows)).not.toContain("0x1");
    expect(JSON.stringify(rows)).not.toContain("ETH");
  });

  test("refuses an id it never issued or no longer holds with the interruption reason", () => {
    const registry = createStrk20JobRegistry({ now: () => 1 });
    // What a restarted worker answers: the panel's id is well-formed, but the
    // job and its outcome lived in the memory of the worker that stopped.
    expect(registry.status("strk20job-abc-1")).toEqual({ error: STRK20_JOB_INTERRUPTED });
    expect(registry.status("")).toEqual({ error: STRK20_JOB_INTERRUPTED });
    expect(registry.status("sha256:aa")).toEqual({ error: STRK20_JOB_INTERRUPTED });
  });

  test("records a throwing job as a failure rather than losing it", async () => {
    const registry = createStrk20JobRegistry({ now: () => 1 });
    const started = registry.start("register", () => Promise.reject(new Error("boom")));
    await flushHeld();
    expect(registry.status(started.strk20Job.id)).toEqual({ error: "wallet request failed" });
  });

  test("holds the worker open only while a job runs", async () => {
    const ticks = { value: 0 };
    const timers = scheduler();
    const registry = createStrk20JobRegistry({
      keepAlive: () => {
        ticks.value += 1;
      },
      now: () => 1,
      schedule: timers.schedule,
    });
    const first = deferred<RuntimeResponse>();
    const second = deferred<RuntimeResponse>();

    registry.start("deposit", () => first.promise);
    registry.start("execute", () => second.promise);
    // One heartbeat for any number of concurrent jobs, at Chrome's cadence.
    expect(timers.intervals).toHaveLength(1);
    expect(timers.intervals[0]?.intervalMs).toBe(STRK20_JOB_KEEPALIVE_MS);
    timers.intervals[0]?.tick();
    expect(ticks.value).toBe(1);

    first.resolve(ok);
    await flushHeld();
    expect(timers.intervals[0]?.cancelled).toBe(false);
    second.resolve(ok);
    await flushHeld();
    expect(timers.intervals[0]?.cancelled).toBe(true);

    // The next job schedules a fresh heartbeat.
    registry.start("deposit", () => Promise.resolve(ok));
    expect(timers.intervals).toHaveLength(2);
  });

  test("keeps only a bounded tail of settled outcomes", async () => {
    const registry = createStrk20JobRegistry({ now: () => 1 });
    const ids: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      ids.push(registry.start("deposit", () => Promise.resolve(ok)).strk20Job.id);
    }
    await flushHeld();
    expect(registry.status(ids[0] ?? "")).toEqual({ error: STRK20_JOB_INTERRUPTED });
    expect(registry.status(ids[1] ?? "")).toEqual({ error: STRK20_JOB_INTERRUPTED });
    expect(registry.status(ids[2] ?? "")).toEqual(ok);
    expect(registry.status(ids[9] ?? "")).toEqual(ok);
  });

  test("mints ids that cannot collide across worker boots", () => {
    const before = createStrk20JobRegistry({ now: () => 1_000 });
    const after = createStrk20JobRegistry({ now: () => 1_001 });
    const a = before.start("deposit", () => Promise.resolve(ok)).strk20Job.id;
    const b = after.start("deposit", () => Promise.resolve(ok)).strk20Job.id;
    expect(a).not.toBe(b);
    expect(before.status(b)).toEqual({ error: STRK20_JOB_INTERRUPTED });
  });
});

const preferences = (): WalletPreferences => ({
  ...defaultWalletPreferences(),
  activeNetworkId: "SN_SEPOLIA",
  strk20Networks: {
    SN_SEPOLIA: {
      discoveryUrl: "https://discovery.example/strk20",
      poolAddress: "0x123",
      proverUrl: "https://prover.example/strk20",
    },
  },
});

const token = preferences().tokens.find(
  (candidate) => candidate.networkId === "SN_SEPOLIA" && candidate.address === STRK20_TOKEN,
);
if (!token) {
  throw new Error("Sepolia token fixture missing");
}

const shield = {
  amount: "1",
  recipient: account.address,
  tokenId: token.id,
  type: "wallet.strk20PrepareDeposit",
};

const poll = (jobId: string | null) => ({ jobId, type: "wallet.strk20PreparationStatus" });

const runningJob = (response: unknown): { readonly id: string; readonly phase?: string } => {
  const id = strk20RunningJobId(response);
  if (id === null) throw new Error(`not a running job: ${JSON.stringify(response)}`);
  const job = (response as { readonly strk20Job: { readonly phase?: string } }).strk20Job;
  return { id, ...(job.phase === undefined ? {} : { phase: job.phase }) };
};

describe("shield route through the job", () => {
  test("answers before the proof exists and settles the poll once it lands", async () => {
    const proof =
      deferred<Awaited<ReturnType<NonNullable<Strk20Service["prepareAccountActions"]>>>>();
    const base = makeStrk20Service({ publicBalance: "2000000000000000000" });
    const handler = buildStrk20Handler({
      preferences: preferences(),
      publicBalance: "2000000000000000000",
      strk20: {
        ...base,
        prepareAccountActions: () => proof.promise,
      },
    });

    const started = await handler(shield, STRK20_EXTENSION_SENDER);
    const jobId = strk20RunningJobId(started);
    expect(jobId).not.toBeNull();
    // The proof is still being built: every poll says so, with the phase the
    // job reached — the background's own steps ahead of the adapter's — and
    // nothing else.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await flushHeld();
      expect(runningJob(await handler(poll(jobId), STRK20_EXTENSION_SENDER))).toEqual({
        id: jobId ?? "",
        phase: "checking the public balance",
      });
    }

    const built = await base.prepareAccountActions?.({} as never);
    if (!built) throw new Error("service double did not build");
    proof.resolve(built);
    await flushHeld();
    const settled = (await handler(poll(jobId), STRK20_EXTENSION_SENDER)) as {
      readonly ok?: boolean;
      readonly strk20Preparation?: { readonly id: string };
    };
    expect(settled.ok).toBe(true);
    expect(settled.strk20Preparation?.id).toMatch(/^sha256:[0-9a-f]{64}$/);
    // The settled review is what the panel executes, exactly as before.
    await expect(executeStrk20Preparation(handler, settled.strk20Preparation?.id)).resolves.toEqual(
      { ok: true, transactionHash: "0x123" },
    );
  });

  test("refuses at the gate on the request itself, without a job", async () => {
    const handler = buildStrk20Handler({ preferences: preferences() });
    const refused = await handler(
      { ...shield, recipient: "not-an-address" },
      STRK20_EXTENSION_SENDER,
    );
    expect(refused).toEqual({ error: "Enter a valid Starknet address" });
    expect(strk20RunningJobId(refused)).toBeNull();
  });

  test("a restarted worker answers a stale poll with the interruption reason", async () => {
    const before = buildStrk20Handler({
      preferences: preferences(),
      publicBalance: "2000000000000000000",
    });
    const started = await before(shield, STRK20_EXTENSION_SENDER);
    const jobId = strk20RunningJobId(started);
    expect(jobId).not.toBeNull();
    expect(await prepareStrk20Deposit(before, shield)).toMatchObject({ ok: true });

    // A fresh handler is what a restarted worker is: the id is well-formed, the
    // job is gone, and the panel must be told rather than left polling.
    const after = buildStrk20Handler({ preferences: preferences() });
    await expect(after(poll(jobId), STRK20_EXTENSION_SENDER)).resolves.toEqual({
      error: STRK20_JOB_INTERRUPTED,
    });
    await expect(after(poll("nope"), STRK20_EXTENSION_SENDER)).resolves.toEqual({
      error: "Invalid preparation status request",
    });
  });
});
