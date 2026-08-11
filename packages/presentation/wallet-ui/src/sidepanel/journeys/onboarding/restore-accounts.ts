/**
 * Adding the accounts a recovery phrase already has on chain, once the user has
 * chosen which ones.
 *
 * The background scan reports every HD position that is deployed or holds a
 * balance; nothing here decides what to add. Selection is the user's, on both
 * surfaces that offer this — setup and the accounts screen — so neither can
 * quietly add an account that was not picked.
 */

import type { SidepanelWallet } from "../../runtime/runtime";

/**
 * What an add run did, for the caller to report.
 *
 * `found` counts every position on chain including ones already held, so "found
 * 3, added 0" can be reported honestly rather than as finding nothing.
 */
export type RestoreOutcome = {
  readonly added: number;
  readonly found: number;
};

/**
 * Adds the chosen HD positions on `networkId`, in ascending order.
 *
 * Sequential by design: each add is a read-modify-write of the vault and the
 * background serializes them anyway, so issuing them together would only queue.
 * A failed add stops the run rather than pressing on, so a reported count is
 * never higher than what was actually added.
 */
export const addAccountsAtIndexes = async (
  wallet: SidepanelWallet,
  networkId: string,
  accountIndexes: readonly number[],
): Promise<number> => {
  let added = 0;
  for (const accountIndex of [...accountIndexes].sort((left, right) => left - right)) {
    await wallet.addAccount(networkId, accountIndex);
    added += 1;
  }
  return added;
};

/**
 * Creates a wallet holding exactly the chosen HD positions.
 *
 * A vault has to start from one account, so the lowest chosen position becomes it
 * and the rest are added after. Taking the lowest *chosen* one rather than always
 * index 0 is what lets a user restore only accounts 3 and 7 without also being
 * handed account 1.
 *
 * Throws when nothing was chosen: a wallet with no accounts is not a wallet, and
 * silently picking one for the user is how a selection screen stops meaning
 * anything.
 */
export const createWalletWithAccounts = async (
  wallet: SidepanelWallet,
  input: {
    readonly accountIndexes: readonly number[];
    readonly mnemonic: string;
    readonly networkId: string;
    readonly vaultPassphrase: string;
  },
): Promise<number> => {
  const [first, ...rest] = [...input.accountIndexes].sort((left, right) => left - right);
  if (first === undefined) {
    throw new Error("Select at least one account before continuing.");
  }
  await wallet.createAccount(input.mnemonic, input.networkId, input.vaultPassphrase, first);
  return 1 + (await addAccountsAtIndexes(wallet, input.networkId, rest));
};

/**
 * The message shown after an add run, naming what happened in the user's terms.
 *
 * Distinguishes "nothing on chain" from "everything already here": the two look
 * identical as a count but mean different things to someone who expected their
 * accounts back.
 */
export const restoreOutcomeMessage = ({ added, found }: RestoreOutcome): string => {
  if (added > 0) {
    return `Added ${added} account${added === 1 ? "" : "s"} from your recovery phrase.`;
  }
  return found > 0
    ? "Every account from your recovery phrase is already here."
    : "No other accounts found for this recovery phrase on this network.";
};
