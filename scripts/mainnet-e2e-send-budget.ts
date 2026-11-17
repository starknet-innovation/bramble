/**
 * Per-send spend check for the live mainnet scripts.
 *
 * The post-run balance check only notices an overspend after funds moved. A
 * live script charges every amount it is about to sign against this budget
 * first, so a buggy test refuses to sign the send that would cross the
 * per-run cap instead of draining the hot wallet before CI goes red. It
 * guards against mistakes in reviewed code, not against hostile code that
 * holds the key; funding the hot wallet near its minimum is that control.
 *
 * In the Mainnet E2E workflow only STRK and native USDC may be spent, each up
 * to its tier's per-run cap. Local runs are unchanged.
 */

import { STRK_TOKEN_ADDRESS, sameFelt, USDC_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { decideMainnetCi, type MainnetCiEnv } from "./mainnet-e2e-guard";
import {
  parseSpendTier,
  type SpendTier,
  spendCeilings,
  type TokenCeiling,
} from "./mainnet-e2e-spend";

/** Running total of what one run has signed. */
export type SendBudget = {
  /**
   * Adds `amount` raw units of `token` to the run's total. Throws, before the
   * caller signs, when the token is not STRK or native USDC, the amount is
   * negative, or the total would exceed the tier's per-run cap. A refused
   * charge is not recorded.
   */
  readonly charge: (token: string, amount: bigint) => void;
};

const ceilingFor = (tier: SpendTier, token: string): TokenCeiling | null => {
  const ceilings = spendCeilings(tier);
  if (sameFelt(token, STRK_TOKEN_ADDRESS)) return ceilings.strk;
  if (sameFelt(token, USDC_TOKEN_ADDRESS)) return ceilings.usdc;
  return null;
};

/**
 * A budget for `tier`, starting at zero. Pure: it holds the running totals in
 * memory and reads nothing.
 */
export const createSendBudget = (tier: SpendTier): SendBudget => {
  const spent = new Map<string, bigint>();
  return {
    charge: (token, amount) => {
      const ceiling = ceilingFor(tier, token);
      if (ceiling === null) {
        throw new Error("Mainnet E2E may only spend STRK or native USDC");
      }
      if (amount < 0n) throw new Error("Mainnet E2E send amount must not be negative");
      const total = (spent.get(ceiling.symbol) ?? 0n) + amount;
      if (total > ceiling.capRaw) {
        throw new Error(
          `Refusing to sign: this run's ${ceiling.symbol} spend would reach ${total} raw units, over the ${ceiling.capRaw} per-run cap`,
        );
      }
      spent.set(ceiling.symbol, total);
    },
  };
};

/**
 * The budget a live script must charge before each signature. `null` for a
 * local run, which keeps its existing ceilings. Throws when the guard refuses
 * this environment or the tier is malformed, so a CI run never signs without
 * a budget.
 */
export const sendBudgetFor = (env: MainnetCiEnv): SendBudget | null => {
  const decision = decideMainnetCi(env);
  if (decision.kind === "local") return null;
  if (decision.kind === "refused") throw new Error(decision.reason);
  return createSendBudget(parseSpendTier(env["MAINNET_E2E_SPEND_TIER"]));
};
