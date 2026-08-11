/**
 * Restoring the accounts a recovery phrase already has on chain.
 *
 * Importing a phrase rebuilds only the first account, so a wallet that had used
 * several came back looking empty. The background scan reports every HD position
 * that is deployed or holds a balance; this adds the ones this wallet does not
 * already hold, at their own positions.
 *
 * There is deliberately no picker. A scan only reports positions with on-chain
 * evidence behind them, so every candidate is an account the user demonstrably
 * has — unlike a Ledger, which offers unlimited derivable accounts with nothing
 * to distinguish them. Asking which of your own existing accounts you would like
 * to keep is a question with one answer.
 *
 * One implementation for both entry points (a fresh import and a wallet imported
 * before this existed), so neither can drift into restoring a different set.
 */

import type { SidepanelWallet } from "./runtime";

/**
 * What a restore attempt did, for the caller to report.
 *
 * `found` counts every position on chain including ones already held, so "found
 * 3, added 0" can be reported honestly rather than as finding nothing.
 */
export type RestoreOutcome = {
  readonly added: number;
  readonly found: number;
};

/**
 * Scans this wallet's phrase and adds every account it does not already hold.
 *
 * Adds sequentially: each add is a read-modify-write of the vault, and the
 * background serializes them anyway, so issuing them together would only queue.
 * A single failed add stops the run rather than pressing on, so the count
 * reported back is never higher than what was actually restored.
 *
 * Rejects when the scan itself fails — an unreachable node must not be reported
 * as "no other accounts found", which would read as the accounts being gone.
 */
export const restoreSeedAccounts = async (
  wallet: SidepanelWallet,
  networkId: string,
): Promise<RestoreOutcome> => {
  const candidates = await wallet.scanSeedAccounts();
  let added = 0;
  for (const candidate of candidates) {
    if (candidate.alreadyAdded) {
      continue;
    }
    await wallet.addAccount(networkId, candidate.accountIndex);
    added += 1;
  }
  return { added, found: candidates.length };
};

/**
 * The message shown after a restore, naming what happened in the user's terms.
 *
 * Distinguishes "nothing on chain" from "everything already here": the two look
 * identical as a count but mean different things to someone who expected their
 * accounts back.
 */
export const restoreOutcomeMessage = ({ added, found }: RestoreOutcome): string => {
  if (added > 0) {
    return `Restored ${added} account${added === 1 ? "" : "s"} from your recovery phrase.`;
  }
  return found > 0
    ? "Every account from your recovery phrase is already here."
    : "No other accounts found for this recovery phrase on this network.";
};
