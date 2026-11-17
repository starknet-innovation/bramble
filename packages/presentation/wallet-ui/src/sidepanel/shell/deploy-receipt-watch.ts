/**
 * What the deployment receipt waits for before it says "Account deployed" or
 * "Deployment failed". A self-paid deploy is the wallet's own transaction, so
 * its hash's outcome in Activity is the answer. A sponsored deploy (issue 431)
 * carries a hash the sponsor's relay named, which proves nothing about this
 * account: success is the chain showing the account's own class at its stored
 * address, and the relay hash's failure is shown only while the chain confirms
 * that address still empty. Anything else stays on the submitted wording.
 */
import { sameFelt } from "@bramble/wallet-model/networks";
import type { SidepanelWallet } from "../runtime/runtime";
import {
  awaitConfirmation,
  CONFIRMATION_DELAYS_MS,
  type ConfirmationOutcome,
  confirmationOutcome,
} from "../shared/confirm-submitted";

/** One receipt's wait: the hash it shows, whose deploy it was, and how to read. */
export type DeployReceiptWatch = {
  /** The account the deploy was for; null never confirms a sponsored deploy. */
  readonly accountId: string | null;
  /** Overrides the checkpoints; tests pass a single zero delay. */
  readonly delaysMs?: readonly number[];
  readonly hash: string;
  /** True when the relay, not this wallet, named `hash`. */
  readonly sponsored: boolean;
  /** False once the screen moved on; checked after every read. */
  readonly stillCurrent: () => boolean;
  readonly wallet: Pick<SidepanelWallet, "loadActivity" | "loadClassHashVerification">;
};

const pause = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

// One checkpoint of a sponsored deploy: the account's class at its address is
// success; the relay hash's failure counts only over a confirmed-empty address.
const sponsoredOutcome = async (watch: DeployReceiptWatch): Promise<ConfirmationOutcome | null> => {
  const answer = await watch.wallet.loadClassHashVerification();
  if (!watch.stillCurrent() || !answer || answer.accountId !== watch.accountId) return null;
  if (answer.verification.status === "verified") return confirmationOutcome("accepted");
  if (answer.verification.status !== "undeployed") return null;
  const { entries } = await watch.wallet.loadActivity();
  if (!watch.stillCurrent()) return null;
  const status = entries.find((entry) => sameFelt(entry.hash, watch.hash))?.status ?? null;
  const outcome = confirmationOutcome(status);
  return outcome?.kind === "failed" ? outcome : null;
};

/**
 * Resolves with the chain's answer for the receipt, or null when the wait ran
 * out or the screen moved on — which the receipt shows as still submitted.
 * Read failures are retried at the next checkpoint, never read as an answer.
 */
export const awaitDeployOutcome = async (
  watch: DeployReceiptWatch,
): Promise<ConfirmationOutcome | null> => {
  if (!watch.sponsored) {
    return awaitConfirmation({
      ...(watch.delaysMs ? { delaysMs: watch.delaysMs } : {}),
      hash: watch.hash,
      loadActivity: () => watch.wallet.loadActivity(),
      stillCurrent: watch.stillCurrent,
    });
  }
  for (const delay of watch.delaysMs ?? CONFIRMATION_DELAYS_MS) {
    await pause(delay);
    if (!watch.stillCurrent()) return null;
    try {
      const outcome = await sponsoredOutcome(watch);
      if (outcome) return outcome;
    } catch {
      // A transient read is retried at the next checkpoint.
    }
  }
  return null;
};
