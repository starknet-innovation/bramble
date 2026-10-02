/**
 * Fixed progress vocabulary for long-running STRK20 work.
 *
 * A private proof runs as a tracked background job the side panel polls for,
 * and every poll may carry the phase the job is in. The labels are a closed
 * set defined once, here, so a phase can only ever be one of these strings —
 * never an address, an amount, a note, a key, or a service response. The
 * adapter reports the phases it owns (maturity, discovery, proving); the
 * background reports the ones around it (registration checks, quotes, fee
 * estimates); the panel validates each label against this list before it
 * renders it.
 */

/**
 * Every phase a STRK20 job can report, in roughly the order a shield meets
 * them. The strings are shown to the user as-is (capitalised by the panel).
 */
export const STRK20_PHASES = [
  "checking registration",
  "reading the pool fee",
  "checking the public balance",
  "quoting the private relay",
  "discovering private notes",
  "waiting for pool maturity",
  "building the proof request",
  "proving",
  "estimating the network fee",
  "signing",
  "broadcasting",
  "relaying privately",
] as const;

/**
 * One label from {@link STRK20_PHASES}.
 */
export type Strk20Phase = (typeof STRK20_PHASES)[number];

/**
 * A phase transition. `attempt`/`attempts` name a bounded retry round
 * (e.g. the third of three throttled proof attempts); both are absent on a
 * first attempt.
 */
export type Strk20PhaseReport = {
  readonly attempt?: number;
  readonly attempts?: number;
  readonly phase: Strk20Phase;
};

/**
 * Progress sink handed to a long operation. Implementations must be cheap and
 * must never throw: the job registry records the label and the time, nothing
 * else.
 */
export type Strk20PhaseSink = (report: Strk20PhaseReport) => void;

/**
 * The reason a job poll receives when the worker that ran the job is gone (or
 * the id was never this worker's). Kind-neutral: the background registry
 * cannot know whether the lost job was a review or a submission, so the panel
 * recognises this exact text and decides — an execution that may have
 * broadcast is reported as status unknown, never as "not sent".
 */
export const STRK20_JOB_INTERRUPTED =
  "The private operation was interrupted because the wallet's background worker stopped. Try again.";

const PHASES: ReadonlySet<string> = new Set<string>(STRK20_PHASES);

/**
 * Checks an untrusted value against the closed phase vocabulary. Used by the
 * side panel on every poll so an unexpected string is dropped, never shown.
 */
export const isStrk20Phase = (value: unknown): value is Strk20Phase =>
  typeof value === "string" && PHASES.has(value);

/**
 * Reports a phase to an optional sink. A missing sink — every request-path
 * caller, and every test that does not care — is a no-op, so operations report
 * unconditionally rather than branching on whether anyone is listening.
 */
export const reportStrk20Phase = (
  sink: Strk20PhaseSink | undefined,
  phase: Strk20Phase,
  round?: { readonly attempt: number; readonly attempts: number },
): void => {
  if (!sink) {
    return;
  }
  sink(round && round.attempt > 1 ? { ...round, phase } : { phase });
};
