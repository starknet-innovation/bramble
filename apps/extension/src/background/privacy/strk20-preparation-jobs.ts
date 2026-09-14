/**
 * Tracked background jobs for STRK20 work that outlives one runtime request.
 *
 * An MV3 service worker answers `runtime.sendMessage` over a channel Chrome
 * closes the moment the worker stops, and Chrome stops a worker whose single
 * in-flight request outlasts its cap — a private proof, with its discovery,
 * maturity wait, remote proving, and fee estimate, routinely does. The side
 * panel then sees only "the message channel closed before a response was
 * received". So a proof is never answered on the request that started it: the
 * start request returns a job id at once, the work runs detached, and the panel
 * polls for the outcome on short requests, each an event that resets the
 * worker's idle timer. `keepAlive` runs on an interval while any job is live, so
 * a hidden or throttled panel cannot let the worker idle out mid-proof either.
 *
 * Three routes run this way: the shield's proof at review, the activation
 * proof at review, and every confirmed execution (a relayed send proves at
 * confirm; a public one waits on pool maturity before it broadcasts). A job
 * reports the phase it is in — a fixed label from `@bramble/privacy/phases`,
 * never anything derived from the account — and every poll carries that label
 * and the elapsed time, so the panel can say what the wait is doing.
 *
 * Outcomes live in worker memory only, exactly like the one-time preparation
 * store a finished job writes into: a restarted worker has neither. A poll for a
 * job this worker never saw is therefore answered with an explicit interruption
 * error, never a wait that cannot end. Job ids carry no secret material and the
 * stored outcome is the same envelope the request path used to return; a poll
 * after settlement returns that stored envelope again and runs nothing.
 *
 * Phase durations and the settled outcome class are recorded into the local
 * reliability diagnostics (off by default, exported only by the user).
 */

import { isStrk20JobId } from "@bramble/core/ids";
import {
  isStrk20Phase,
  type Strk20PhaseReport,
  type Strk20PhaseSink,
} from "@bramble/privacy/phases";
import { STRK20_SERVICE_UNAVAILABLE } from "@bramble/privacy/service";
import {
  type PrivacyJobKind,
  type PrivacyOutcome,
  recordPrivacyDiagnostic,
} from "@bramble/starknet/rpc-diagnostics";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { Strk20JobResponse } from "./runtime-strk20-types";

/**
 * How many settled outcomes are retained for late polls before the oldest is
 * dropped. Running jobs are never evicted.
 */
const MAX_SETTLED_JOBS = 8;

/**
 * Chrome stops an extension worker after 30 seconds without an event or an
 * extension API call; a call every 20 seconds is the cadence Chrome's own
 * lifecycle guidance uses to hold a worker open through long work.
 */
export const STRK20_JOB_KEEPALIVE_MS = 20_000;

/**
 * The reason a poll receives when the worker that ran its job is gone. Named
 * so the panel can show it verbatim and tests can pin it. Kind-neutral: the
 * registry cannot know whether the lost job was a review or a submission.
 */
export const STRK20_JOB_INTERRUPTED =
  "The private operation was interrupted because the wallet's background worker stopped. Try again.";

// Which route a job runs: the diagnostics lane it is aggregated under.
type Strk20JobKind = PrivacyJobKind;

// The detached work of one job. It receives the phase sink to report through
// and must never throw: a handler that returns its own error envelope keeps
// the failure reportable, so a rejection is recorded as a generic failure
// rather than lost.
type Strk20JobWork = (report: Strk20PhaseSink) => Promise<RuntimeResponse>;

// Diagnostics sink for phase durations and outcomes; defaults to the local
// reliability counters.
type Strk20JobDiagnostics = (
  kind: Strk20JobKind,
  phase: string,
  outcome: PrivacyOutcome,
  durationMs: number,
) => void;

/**
 * Collaborators of the registry. Every clock and timer is injected so the
 * registry stays deterministic under test.
 */
export type Strk20JobRegistryOptions = {
  readonly diagnostics?: Strk20JobDiagnostics;
  /**
   * Extension API touch that resets the worker's idle timer, e.g.
   * `chrome.runtime.getPlatformInfo`. Absent in tests and in runtimes without
   * one; the registry then relies on the panel's polls alone.
   */
  readonly keepAlive?: () => void;
  readonly keepAliveIntervalMs?: number;
  /** Wall clock: ids unique across worker restarts, elapsed time, durations. */
  readonly now: () => number;
  /** Interval scheduler; defaults to `setInterval` and returns its canceller. */
  readonly schedule?: (tick: () => void, intervalMs: number) => () => void;
};

/**
 * Starts and reports tracked STRK20 jobs. Instance-scoped to one worker.
 */
export type Strk20JobRegistry = {
  /** Whether at least one job is still running. */
  readonly active: () => boolean;
  /**
   * Runs `work` detached and returns the running-job envelope the caller sends
   * back immediately.
   */
  readonly start: (kind: Strk20JobKind, work: Strk20JobWork) => Strk20JobResponse;
  /**
   * The running envelope (with phase and elapsed time) while the job runs, the
   * job's own response once it has settled, or the interruption error for an
   * id this worker does not know.
   */
  readonly status: (jobId: string) => RuntimeResponse;
};

type RunningJob = {
  readonly kind: Strk20JobKind;
  phase: Strk20PhaseReport | null;
  phaseStartedAt: number;
  readonly startedAt: number;
};

const defaultSchedule = (tick: () => void, intervalMs: number): (() => void) => {
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
};

// The outcome class of a settled response, by the reviewed prefixes the
// privacy pipeline uses; the text itself is not retained.
const outcomeOf = (response: RuntimeResponse): PrivacyOutcome => {
  if (!("error" in response)) {
    return "ok";
  }
  if (/ did not finish within [0-9]+ s$/.test(response.error)) {
    return "timeout";
  }
  if (response.error.startsWith("wallet locked")) {
    return "locked";
  }
  return response.error.startsWith(STRK20_SERVICE_UNAVAILABLE) ? "unavailable" : "error";
};

/**
 * Creates the in-memory job registry for one worker instance.
 */
export const createStrk20JobRegistry = (options: Strk20JobRegistryOptions): Strk20JobRegistry => {
  const schedule = options.schedule ?? defaultSchedule;
  const diagnostics = options.diagnostics ?? recordPrivacyDiagnostic;
  const intervalMs = options.keepAliveIntervalMs ?? STRK20_JOB_KEEPALIVE_MS;
  // Ids are unique across restarts without randomness: a worker cannot boot
  // twice in the same millisecond, and the counter separates jobs within one.
  const boot = options.now().toString(36);
  let counter = 0;
  const running = new Map<string, RunningJob>();
  const settled = new Map<string, RuntimeResponse>();
  let cancelKeepAlive: (() => void) | null = null;

  const runningEnvelope = (id: string, job: RunningJob): Strk20JobResponse => ({
    ok: true,
    strk20Job: {
      elapsedMs: Math.max(0, options.now() - job.startedAt),
      id,
      state: "running",
      ...(job.phase ?? {}),
    },
  });

  const settle = (id: string, response: RuntimeResponse): void => {
    const job = running.get(id);
    running.delete(id);
    settled.set(id, response);
    if (job) {
      const now = options.now();
      const outcome = outcomeOf(response);
      if (job.phase) {
        diagnostics(job.kind, job.phase.phase, outcome, now - job.phaseStartedAt);
      }
      diagnostics(job.kind, "job", outcome, now - job.startedAt);
    }
    if (running.size === 0 && cancelKeepAlive) {
      cancelKeepAlive();
      cancelKeepAlive = null;
    }
    for (const oldest of [...settled.keys()].slice(
      0,
      Math.max(0, settled.size - MAX_SETTLED_JOBS),
    )) {
      settled.delete(oldest);
    }
  };

  const sinkFor =
    (id: string): Strk20PhaseSink =>
    (report) => {
      const job = running.get(id);
      if (!job || !isStrk20Phase(report.phase)) {
        return;
      }
      const now = options.now();
      if (job.phase) {
        diagnostics(job.kind, job.phase.phase, "ok", now - job.phaseStartedAt);
      }
      job.phase = {
        phase: report.phase,
        ...(report.attempt !== undefined && report.attempts !== undefined
          ? { attempt: report.attempt, attempts: report.attempts }
          : {}),
      };
      job.phaseStartedAt = now;
    };

  return {
    active: () => running.size > 0,
    start(kind, work) {
      counter += 1;
      const id = `strk20job-${boot}-${counter}`;
      const startedAt = options.now();
      const job: RunningJob = { kind, phase: null, phaseStartedAt: startedAt, startedAt };
      running.set(id, job);
      if (options.keepAlive && !cancelKeepAlive) {
        const keepAlive = options.keepAlive;
        cancelKeepAlive = schedule(keepAlive, intervalMs);
      }
      void work(sinkFor(id)).then(
        (response) => settle(id, response),
        () => settle(id, { error: "wallet request failed" }),
      );
      return runningEnvelope(id, job);
    },
    status(jobId) {
      if (!isStrk20JobId(jobId)) {
        return { error: STRK20_JOB_INTERRUPTED };
      }
      const job = running.get(jobId);
      if (job) {
        return runningEnvelope(jobId, job);
      }
      return settled.get(jobId) ?? { error: STRK20_JOB_INTERRUPTED };
    },
  };
};
