/**
 * What every journey does between submitting a transaction and telling the
 * reader it worked.
 *
 * A screen that says "complete" the instant a hash comes back is claiming
 * something the wallet has not checked: submission is not execution, and a
 * transaction can still revert. So each journey that reports a settled
 * transaction polls the activity log for the hash it submitted and reports the
 * outcome the chain gives it.
 *
 * It completes on a PRE-CONFIRMATION rather than waiting for L2 acceptance. A
 * pre-confirmation is a real answer — the proposer has executed the transaction
 * and its revert status is already known — so waiting past it holds a spinner
 * in front of a reader for an answer that will not change. Background
 * reconciliation keeps verifying through to finality and raises a notice if it
 * later fails.
 *
 * Shared because Send, Swap, account deployment and NFT transfer each need it
 * and each had a different amount of it: Send polled, the other three declared
 * success on the hash alone.
 */
import type { ActivityEntry } from "@bramble/transactions/activity";
import { sameFelt } from "@bramble/wallet-model/networks";

/**
 * What a journey should do about the latest chain status: finish, fail with a
 * reason the reader can act on, or — `null` — keep waiting.
 */
export type ConfirmationOutcome =
  | { readonly kind: "failed"; readonly message: string; readonly toast: string }
  | { readonly kind: "succeeded"; readonly toast: string };

// One row per status a journey acts on. Statuses absent here — `pending`, and
// no status observed yet — mean keep waiting.
const CONFIRMATION_OUTCOMES: Partial<Record<ActivityEntry["status"], ConfirmationOutcome>> = {
  accepted: { kind: "succeeded", toast: "Transaction confirmed on Starknet" },
  preconfirmed: { kind: "succeeded", toast: "Transaction pre-confirmed on Starknet" },
  rejected: {
    kind: "failed",
    message: "Starknet rejected this transaction. No transfer was completed.",
    toast: "Transaction was not confirmed",
  },
  reverted: {
    kind: "failed",
    message: "Starknet reverted this transaction. Review its activity details before retrying.",
    toast: "Transaction was not confirmed",
  },
};

/**
 * Confirmation checkpoints in milliseconds, paired with the outcome table
 * above: a tight burst for the common case, then ten-second checks out to
 * roughly a minute. Every checkpoint is a live chain read, so this is the
 * journey's patience rather than the chain's — it completes on a
 * pre-confirmation, but a proposer can take longer than a ten-second burst to
 * report even that.
 */
export const CONFIRMATION_DELAYS_MS: readonly number[] = [
  0, 250, 500, 900, 1_500, 2_500, 4_000, 5_000, 7_500, 10_000, 10_000, 10_000,
];

// Finds the current chain status for one submitted hash.
const confirmationStatus = (
  entries: readonly ActivityEntry[],
  transactionHash: string,
): ActivityEntry["status"] | null =>
  entries.find((entry) => sameFelt(entry.hash, transactionHash))?.status ?? null;

/**
 * Maps the latest observed status onto that decision.
 */
export const confirmationOutcome = (
  status: ActivityEntry["status"] | null,
): ConfirmationOutcome | null => (status === null ? null : (CONFIRMATION_OUTCOMES[status] ?? null));

/** Collaborators the wait closes over. */
export type ConfirmationWatch = {
  /** Overrides the checkpoints; tests pass a single zero delay. */
  readonly delaysMs?: readonly number[];
  readonly hash: string;
  readonly loadActivity: () => Promise<{ readonly entries: readonly ActivityEntry[] }>;
  /**
   * False once the journey this wait belongs to has moved on — a new
   * submission, a different account, a closed screen. Checked after every
   * await, so a late read can never repaint a screen that is gone.
   */
  readonly stillCurrent: () => boolean;
  /** Overrides the timer; tests resolve immediately. */
  readonly wait?: (delayMs: number) => Promise<void>;
};

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

/**
 * Polls to the last checkpoint and resolves with the chain's answer, or `null`
 * when the journey ran out of patience before the chain answered — which is not
 * a failure and the caller should report as still pending. Also resolves `null`
 * once `stillCurrent` turns false, so an abandoned wait settles quietly.
 *
 * A transient activity read is swallowed and retried at the next checkpoint: a
 * momentary read failure is not evidence about the transaction.
 */
export const awaitConfirmation = async (
  watch: ConfirmationWatch,
): Promise<ConfirmationOutcome | null> => {
  const wait = watch.wait ?? sleep;
  for (const delay of watch.delaysMs ?? CONFIRMATION_DELAYS_MS) {
    await wait(delay);
    if (!watch.stillCurrent()) return null;
    try {
      const activity = await watch.loadActivity();
      if (!watch.stillCurrent()) return null;
      const outcome = confirmationOutcome(confirmationStatus(activity.entries, watch.hash));
      if (outcome) return outcome;
    } catch {
      // A transient activity read is retried at the next scheduled checkpoint.
    }
  }
  return null;
};
