/**
 * The panel's half of a tracked background job.
 *
 * A private proof is not answered on the request that starts it: an MV3
 * worker's reply channel closes when Chrome stops the worker, and Chrome stops
 * a worker whose single request outlasts its cap, which a proof can. So the
 * start request returns a job id and the outcome is polled on short requests.
 * Three routes work this way — a shield's review, an activation's review, and
 * every confirmed execution — and all three poll the same status message.
 *
 * Every poll while the job runs carries the phase the job last reported (a
 * label from the closed vocabulary in `@bramble/privacy/phases`, validated
 * here before it is handed on) and how long the job has run, so the working
 * screen can say what the wait is doing. A poll that finds no such job — the
 * worker restarted — is answered by the background with an explicit reason; a
 * channel that fails outright is reported here as
 * {@link PREPARATION_CHANNEL_LOST}. Either way the caller's promise settles, so
 * the screen always leaves its working state.
 */

import { isStrk20JobId } from "@bramble/core/ids";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { isStrk20Phase, STRK20_JOB_INTERRUPTED, type Strk20Phase } from "@bramble/privacy/phases";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";

/**
 * How often the panel asks after a proof it is waiting on. Each poll is a short
 * request, and each one is an event that resets the background worker's idle
 * timer, so the cadence doubles as the worker's keepalive while the panel is
 * visible.
 */
export const PREPARATION_POLL_MS = 1_500;

/**
 * What the panel reports when the runtime channel itself fails between the
 * start of a job and its outcome — the worker was stopped, so the job and its
 * result are gone. Named so the screens can be tested against it.
 */
export const PREPARATION_CHANNEL_LOST =
  "The wallet's background worker stopped before the private operation finished. Try again.";

/**
 * The latest progress of a running job, as reported by one poll. `phase` is
 * absent until the job reports its first phase; `attempt`/`attempts` name a
 * bounded retry round.
 */
export type PreparationProgress = {
  readonly attempt?: number;
  readonly attempts?: number;
  readonly elapsedMs: number;
  readonly phase?: Strk20Phase;
};

const defaultPause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Seams of the poll: `pause` is its timing (tests and the UI Lab pass an
 * immediate one), `onProgress` receives every running poll's progress.
 */
export type PreparationJobOptions = {
  readonly onProgress?: (progress: PreparationProgress) => void;
  readonly pause?: (ms: number) => Promise<void>;
};

const MAX_ATTEMPTS = 16;

const isCount = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;

// A running job: its id, plus the progress fields, each validated against the
// closed vocabulary or a small numeric bound. Anything else — including a
// well-formed envelope carrying an unknown phase — is not a running job, so the
// caller sees the reply as the job's own (malformed) outcome rather than
// polling forever on a shape it does not understand.
const readRunningJob = (
  response: unknown,
): { readonly id: string; readonly progress: PreparationProgress } | null => {
  if (
    !isRecord(response) ||
    !hasOnlyKnownKeys(response, ["ok", "strk20Job"]) ||
    response["ok"] !== true ||
    !isRecord(response["strk20Job"])
  ) {
    return null;
  }
  const job = response["strk20Job"];
  if (
    !hasOnlyKnownKeys(job, ["attempt", "attempts", "elapsedMs", "id", "phase", "state"]) ||
    !isStrk20JobId(job["id"]) ||
    job["state"] !== "running" ||
    !isCount(job["elapsedMs"], Number.MAX_SAFE_INTEGER) ||
    (job["phase"] !== undefined && !isStrk20Phase(job["phase"])) ||
    (job["attempt"] === undefined) !== (job["attempts"] === undefined) ||
    (job["attempt"] !== undefined &&
      (!isCount(job["attempt"], MAX_ATTEMPTS) ||
        !isCount(job["attempts"], MAX_ATTEMPTS) ||
        job["attempt"] > job["attempts"]))
  ) {
    return null;
  }
  return {
    id: job["id"],
    progress: {
      elapsedMs: job["elapsedMs"],
      ...(isStrk20Phase(job["phase"]) ? { phase: job["phase"] } : {}),
      ...(isCount(job["attempt"], MAX_ATTEMPTS) && isCount(job["attempts"], MAX_ATTEMPTS)
        ? { attempt: job["attempt"], attempts: job["attempts"] }
        : {}),
    },
  };
};

/**
 * Sends the request that starts a job and polls until the job settles,
 * returning the settled reply for the caller to validate exactly as it would a
 * direct one. A reply that is not a running job is returned as-is: a refusal
 * made at the gate before any job existed, the job's outcome, or the
 * background's own "interrupted" refusal for a job the worker no longer has.
 * Rejects with {@link PREPARATION_CHANNEL_LOST} if the channel itself fails at
 * any point, so the caller's promise settles either way.
 */
export const runPreparationJob = async (
  sendMessage: (message: unknown) => Promise<unknown>,
  start: Readonly<Record<string, unknown>>,
  options: PreparationJobOptions = {},
): Promise<unknown> => {
  const pause = options.pause ?? defaultPause;
  const send = async (message: unknown): Promise<unknown> => {
    try {
      return await sendMessage(message);
    } catch {
      throw new Error(PREPARATION_CHANNEL_LOST);
    }
  };
  let response = await send(start);
  let job = readRunningJob(response);
  while (job !== null) {
    options.onProgress?.(job.progress);
    await pause(PREPARATION_POLL_MS);
    response = await send({ jobId: job.id, type: "wallet.strk20PreparationStatus" });
    job = readRunningJob(response);
  }
  return response;
};

/**
 * What a confirmed private execution reports when its worker was lost after
 * the job may have broadcast. Named so the screens can be tested against it.
 */
export const PRIVATE_EXECUTION_UNKNOWN =
  "The wallet's background worker stopped while sending this private transaction, so its status is unknown. Check Activity before trying again.";

/**
 * {@link runPreparationJob} for a confirmed execution, which may broadcast.
 * Losing the worker there — the channel failing ({@link PREPARATION_CHANNEL_LOST})
 * or a poll answered with the background's {@link STRK20_JOB_INTERRUPTED} — does
 * not mean nothing was sent, so both reject with a {@link SubmissionUnknownError}
 * (no hash: the panel never learned one) instead of a plain failure that would
 * read as "not sent" and invite a blind re-send (audit 173). Every other reply
 * is returned for the caller to validate as usual.
 */
export const runExecutionJob = async (
  sendMessage: (message: unknown) => Promise<unknown>,
  start: Readonly<Record<string, unknown>>,
  options: PreparationJobOptions = {},
): Promise<unknown> => {
  let response: unknown;
  try {
    response = await runPreparationJob(sendMessage, start, options);
  } catch (error) {
    if (error instanceof Error && error.message === PREPARATION_CHANNEL_LOST) {
      throw new SubmissionUnknownError(PRIVATE_EXECUTION_UNKNOWN, null);
    }
    throw error;
  }
  if (
    isRecord(response) &&
    hasOnlyKnownKeys(response, ["error"]) &&
    response["error"] === STRK20_JOB_INTERRUPTED
  ) {
    throw new SubmissionUnknownError(PRIVATE_EXECUTION_UNKNOWN, null);
  }
  return response;
};

// Elapsed time as the working screen shows it: whole seconds under a minute,
// then minutes and seconds.
const elapsedText = (elapsedMs: number): string => {
  const seconds = Math.floor(elapsedMs / 1_000);
  if (seconds < 60) {
    return `${seconds} s`;
  }
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
};

/**
 * One line of copy for a running job's progress, e.g.
 * "Proving (attempt 2 of 3) · 1 min 12 s". A job that has not reported a phase
 * yet is "Starting". Built only from the validated vocabulary and numbers, so
 * it is safe to render as text.
 */
export const preparationProgressText = (progress: PreparationProgress): string => {
  const phase = progress.phase ?? "starting";
  const label = phase.charAt(0).toUpperCase() + phase.slice(1);
  const round =
    progress.attempt !== undefined && progress.attempts !== undefined
      ? ` (attempt ${progress.attempt} of ${progress.attempts})`
      : "";
  return `${label}${round} · ${elapsedText(progress.elapsedMs)}`;
};
