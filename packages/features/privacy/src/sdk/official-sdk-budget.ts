/**
 * Wall-clock budgets for the waits inside a private proof.
 *
 * The pinned SDK talks to the discovery indexer and the prover through fetch
 * calls the wallet cannot inject a deadline into, and its discovery pagination
 * loops until the service says the cursor is complete. The maturity wait polls
 * the node until a proving block is deep enough. Each of those can keep
 * answering "not yet" — a lagging indexer, a cursor that never advances, a node
 * that cannot serve historical calls — and a caller with no clock on the wait
 * would sit on "Preparing shield" forever with nothing to report. Every such
 * wait therefore runs inside a budget from this module: when it lapses the
 * operation fails with a reason that names the phase, and the job that ran it
 * settles instead of hanging.
 *
 * A budget does not cancel the underlying network work — the SDK exposes no
 * handle to — it only bounds how long the wallet waits for it. The budgets are
 * generous relative to a healthy service (a shield proves in seconds) so a
 * lapse means something is wrong, not merely slow.
 */

import { WalletError } from "@bramble/core/errors";
import type { Strk20Phase } from "../policy/phases";
import { STRK20_SERVICE_UNAVAILABLE } from "../service";

/**
 * Per-phase ceilings in milliseconds. `discovery` covers one indexer read
 * (preflight, note or channel discovery); `maturity` the proving-block wait,
 * which includes waiting for a prior write of this account to be accepted;
 * `proofRequest` building the proof invocation, which refreshes discovery and
 * fetches the pool nonce; `proving` the remote prove, whose SDK-internal
 * budget is 30 s per attempt over four attempts.
 */
export type Strk20WaitBudgets = {
  readonly discovery: number;
  readonly maturity: number;
  readonly proofRequest: number;
  readonly proving: number;
};

/**
 * The remote prover's per-request deadline and transient-failure retries,
 * handed to the SDK explicitly rather than inherited from its defaults so the
 * worst case is pinned here: four attempts of 30 s plus 1 + 2 + 4 s of
 * backoff, comfortably inside the `proving` budget below.
 */
export const STRK20_PROVER_REQUEST = { requestTimeoutMs: 30_000, retries: 3 } as const;

/**
 * Production budgets. Pinned in one place so the adapter, the job diagnostics,
 * and the tests that stall each phase agree on the ceiling.
 */
export const STRK20_WAIT_BUDGETS: Strk20WaitBudgets = {
  discovery: 60_000,
  maturity: 300_000,
  proofRequest: 120_000,
  proving: 180_000,
};

/**
 * Timer seam: schedules `tick` after `delayMs` and returns its canceller.
 * Defaults to `setTimeout`; tests inject a manual scheduler.
 */
export type WaitScheduler = (tick: () => void, delayMs: number) => () => void;

/**
 * The budgets and timer one adapter instance runs every wait under.
 */
export type Strk20Waits = {
  readonly budgets: Strk20WaitBudgets;
  readonly schedule?: WaitScheduler;
};

const defaultScheduler: WaitScheduler = (tick, delayMs) => {
  const handle = setTimeout(tick, delayMs);
  return () => clearTimeout(handle);
};

/**
 * The reason a lapsed budget fails with. Prefixed with the reviewed
 * service-unavailable line so every existing error classifier still treats it
 * as a service condition, and named so the panel and the tests can pin it.
 */
export const strk20WaitExceeded = (phase: Strk20Phase, budgetMs: number): string =>
  `${STRK20_SERVICE_UNAVAILABLE}: ${phase} did not finish within ${Math.round(budgetMs / 1_000)} s`;

/**
 * Whether an error is a lapsed wait budget, by its reason text.
 */
export const isStrk20WaitExceeded = (error: unknown): boolean =>
  error instanceof WalletError && / did not finish within [0-9]+ s$/.test(error.message);

/**
 * One open budget: `expired` lets a polling loop stop early, `expiry` rejects
 * a race once the budget lapses, and `release` cancels the timer once the
 * work has settled.
 */
export type Strk20WaitBudget = {
  readonly expired: () => boolean;
  readonly expiry: Promise<never>;
  readonly release: () => void;
};

/**
 * Opens a budget for one phase. The expiry promise is pre-handled so a budget
 * that lapses after its work settled never surfaces as an unhandled rejection.
 */
export const openStrk20WaitBudget = (
  phase: Strk20Phase,
  budgetMs: number,
  schedule: WaitScheduler = defaultScheduler,
): Strk20WaitBudget => {
  let expired = false;
  let cancel: () => void = () => undefined;
  const expiry = new Promise<never>((_, reject) => {
    cancel = schedule(() => {
      expired = true;
      reject(new WalletError(strk20WaitExceeded(phase, budgetMs)));
    }, budgetMs);
  });
  expiry.catch(() => undefined);
  return {
    expired: () => expired,
    expiry,
    release: () => {
      cancel();
    },
  };
};

/**
 * Runs `work` under a budget for `phase`: resolves with the work's result, or
 * rejects with {@link strk20WaitExceeded} once the budget lapses, whichever
 * comes first. The timer is released either way.
 */
export const withinStrk20WaitBudget = async <T>(
  phase: Strk20Phase,
  budgetMs: number,
  work: (budget: Strk20WaitBudget) => Promise<T>,
  schedule: WaitScheduler = defaultScheduler,
): Promise<T> => {
  const budget = openStrk20WaitBudget(phase, budgetMs, schedule);
  try {
    return await Promise.race([work(budget), budget.expiry]);
  } finally {
    budget.release();
  }
};
