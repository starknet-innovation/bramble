/**
 * The order a live mainnet script must follow for each send that moves funds:
 * charge the reviewed fee to the run's budget, then sign and submit. Kept
 * apart from the gasless script so tests can prove that order without loading
 * the live transport.
 */

import type { SendBudget } from "./mainnet-e2e-send-budget";

/** The reviewed fee a send may cost: token address and raw amount as text. */
export type ReviewedFee = { readonly amount: string; readonly tokenAddress: string };

/**
 * Charges `fee` to `budget` now, then returns `submit` for the caller to run.
 * A refused charge throws here, synchronously, so the caller's own error
 * handling around the submit never sees it and the signer never runs.
 * `budget` is `null` on a local run, which keeps its existing ceilings.
 */
export const chargeBeforeSigning = <T>(
  budget: SendBudget | null,
  fee: ReviewedFee,
  submit: () => Promise<T>,
): (() => Promise<T>) => {
  budget?.charge(fee.tokenAddress, BigInt(fee.amount));
  return submit;
};
