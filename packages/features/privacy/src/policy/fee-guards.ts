/**
 * Affordability and fee-bound guards applied before a private batch is proved.
 *
 * These run on the frozen plan, immediately before shielded balance is spent,
 * and are deliberately separate from the service that calls them: each one is
 * a refusal the wallet owes the user, and they should be readable without the
 * surrounding orchestration.
 */

import { WalletError } from "@bramble/core/errors";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { Strk20Action, Strk20BalanceEntry } from "@bramble/wallet-protocol/strk20";
import { STRK20_FEE_ABOVE_CEILING } from "./fee-policy";
import type { Strk20SubmissionPlan } from "./submission-plan";

/**
 * Raised when a batch spends more of a token than the account holds privately.
 */
export const STRK20_INSUFFICIENT_BALANCE = "insufficient private balance";

/**
 * Distinct tokens a batch spends privately, for a single balance read.
 */
export const spentTokens = (actions: readonly Strk20Action[]): readonly string[] => {
  const seen = new Map<bigint, string>();
  for (const action of actions) {
    if (action.type === "withdraw" || action.type === "transfer") {
      seen.set(BigInt(action.token), action.token);
    }
  }
  return [...seen.values()];
};

/**
 * Refuses a batch whose per-token private spend exceeds the held balance.
 * `OPEN` notes carry no amount and are not counted.
 */
export const assertSufficientPrivateBalance = (
  actions: readonly Strk20Action[],
  balances: readonly Strk20BalanceEntry[],
): void => {
  const required = new Map<bigint, bigint>();
  for (const action of actions) {
    if ((action.type === "withdraw" || action.type === "transfer") && action.amount !== "OPEN") {
      const token = BigInt(action.token);
      required.set(token, (required.get(token) ?? 0n) + BigInt(action.amount));
    }
  }
  for (const [token, amount] of required) {
    const entry = balances.find((balance) => BigInt(balance.token) === token);
    if (amount > (entry ? BigInt(entry.balance) : 0n)) {
      throw new WalletError(STRK20_INSUFFICIENT_BALANCE);
    }
  }
};

/**
 * Refuses a relay route whose fee the account cannot pay privately, counting
 * the fee alongside same-token spend in the batch it rides with.
 */
export const assertFeeBalance = async <Context>(
  service: {
    readonly privateBalances: (
      input: Context & { readonly tokens: readonly string[] },
    ) => Promise<readonly Strk20BalanceEntry[]>;
  },
  input: Context & {
    readonly actions: readonly Strk20Action[];
    readonly plan: Strk20SubmissionPlan;
  },
): Promise<void> => {
  if (input.plan.mode === "account") {
    return;
  }
  const feeAction = input.plan.feeAction;
  const balances = await service.privateBalances({ ...input, tokens: [feeAction.token] });
  const sameTokenSpend = input.actions.filter(
    (action) =>
      (action.type === "withdraw" || action.type === "transfer") &&
      sameFelt(action.token, feeAction.token),
  );
  assertSufficientPrivateBalance([...sameTokenSpend, feeAction], balances);
};

/**
 * Re-checks the bound the user reviewed against the fee about to be proved.
 *
 * The plan is bound into the approval digest, so a substituted amount should
 * never reach here; this refuses one that did, on the same comparison the
 * quote was admitted under, rather than trusting the digest alone. A ceiling
 * that cannot be parsed is treated as exceeded.
 */
export const assertReviewedFeeCeiling = (plan: Strk20SubmissionPlan): void => {
  if (plan.mode === "account" || !plan.feeCeiling) {
    return;
  }
  let quoted: bigint;
  let ceiling: bigint;
  try {
    quoted = BigInt(plan.feeAction.amount);
    ceiling = BigInt(plan.feeCeiling.ceiling);
  } catch {
    throw new WalletError(STRK20_FEE_ABOVE_CEILING);
  }
  if (quoted > ceiling) {
    throw new WalletError(STRK20_FEE_ABOVE_CEILING);
  }
};
