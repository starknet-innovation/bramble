/**
 * Public portfolio data for one watched multisig, shared by the multisig home
 * and its private-balances section without importing either renderer.
 */
import type { DisplayCurrency } from "@bramble/settings/preferences";
import type { BalanceState } from "../../runtime/runtime";

/**
 * Public portfolio data resolved for one watched multisig address.
 */
export type MultisigPortfolioData = {
  readonly balances: BalanceState;
  readonly changes: Readonly<Record<string, number>>;
  readonly currency: DisplayCurrency;
  readonly prices: Readonly<Record<string, number>>;
};

/**
 * Honest loading state used until the selected multisig's own balance request
 * returns. It renders no cached signer assets, and reads as loading rather
 * than as a failed read (issue 795).
 */
export const EMPTY_MULTISIG_PORTFOLIO: MultisigPortfolioData = {
  balances: { loading: true },
  changes: {},
  currency: "usd",
  prices: {},
};
