/**
 * Pure account-visibility mutation for the preferences store, kept apart from
 * `preferences.ts` to hold it under the file-size cap, the way the tracked-token
 * mutations live in `preferences-tokens.ts`.
 *
 * Hiding is a view filter, not a permission change. It records the account id in
 * `hiddenAccountIds` and changes nothing in the vault, so a hidden account keeps
 * its signing key, its viewing key and its origin grants. The list holds
 * canonical account ids, so a stored id is checked with the same validator the
 * account model uses.
 */
import { WalletError } from "@bramble/core/errors";
import { isAccountId } from "@bramble/wallet-model/accounts";
import type { WalletPreferences } from "./preferences-types";

/**
 * Returns preferences with `accountId` hidden or revealed. Throws
 * {@link WalletError}, writing nothing, for a malformed id. Revealing an id
 * that is not stored leaves the list otherwise unchanged.
 */
export const withAccountHidden = (
  preferences: WalletPreferences,
  accountId: string,
  hidden: boolean,
): WalletPreferences => {
  if (!isAccountId(accountId)) {
    throw new WalletError("Invalid account");
  }
  const current = preferences.hiddenAccountIds ?? [];
  const hiddenAccountIds = hidden
    ? [...new Set([...current, accountId])]
    : current.filter((stored) => stored !== accountId);
  return { ...preferences, hiddenAccountIds };
};
