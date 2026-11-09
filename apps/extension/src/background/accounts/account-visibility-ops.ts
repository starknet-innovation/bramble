/**
 * Account visibility: the panel-only `wallet.setAccountHidden` message.
 *
 * Hiding is a preference write rather than a vault change, but it decides which
 * account the panel opens on, so the whole operation runs on the active-state
 * coordinator. Two states are refused because the rest of the wallet cannot
 * render them: hiding the last account a network still shows, and hiding the
 * active account without first moving to another one on the same network.
 */

import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { readSetAccountHiddenInput } from "../routing/message-inputs";
import {
  type ActiveStateCoordinator,
  readUnlockedVault,
  runActiveStateMutation,
  selectAccountLocked,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { UnlockSession } from "../runtime/session";
import type { WalletStatusReader } from "./wallet-reader";

/**
 * Dependencies of the account-visibility handler. The wallet, session and
 * preferences stores are the same collaborators the account operations use.
 */
export type AccountVisibilityDeps = {
  /** Serializes network/account selection writes; production always supplies it. */
  readonly activeStateCoordinator?: ActiveStateCoordinator;
  readonly preferencesStore: WalletPreferencesStore;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * What hiding one account would require. `switchTo` names a visible account on
 * the same network the panel must move to first; `refuse` carries the reason the
 * hide cannot happen; `none` means the account is not active, so nothing else
 * has to change.
 */
type AccountHideDecision =
  | { readonly kind: "none" }
  | { readonly kind: "refuse"; readonly reason: string }
  | { readonly kind: "switchTo"; readonly accountId: string };

/**
 * Decides the account move a hide needs, without performing it. Pure so the
 * three outcomes can be asserted directly.
 *
 * The last-visible refusal is per network, not per wallet: `accountForNetwork`
 * prefers a visible account on the network and only falls back to a hidden one
 * when none is visible, so a network left with no visible account would open on
 * one no list renders.
 */
export const decideAccountHide = (
  accounts: readonly AccountRef[],
  activeAccountId: string | null,
  hiddenAccountIds: readonly string[],
  accountId: string,
): AccountHideDecision => {
  const target = accounts.find((account) => account.id === accountId);
  if (!target) {
    return { kind: "refuse", reason: "Unknown account" };
  }
  const hidden = new Set(hiddenAccountIds);
  const successor = accounts.find(
    (account) =>
      account.networkId === target.networkId && account.id !== accountId && !hidden.has(account.id),
  );
  if (!successor) {
    return { kind: "refuse", reason: "Can't hide the last account on this network" };
  }
  return activeAccountId === accountId
    ? { kind: "switchTo", accountId: successor.id }
    : { kind: "none" };
};

/**
 * Prepares one hide: with the vault and preferences read in the same
 * coordinator section, decide what the hide requires and, when the account
 * being hidden is the active one, move the wallet to a visible successor first.
 * Returns the refusal to send back, or null when the hide may proceed.
 */
const prepareHide = async (
  deps: AccountVisibilityDeps,
  accountId: string,
): Promise<RuntimeResponse | null> => {
  const vault = await readUnlockedVault(deps.wallet, deps.session);
  if (!vault) {
    return { error: "wallet locked" };
  }
  const preferences = await deps.preferencesStore.read();
  const decision = decideAccountHide(
    vault.accounts,
    vault.activeAccountId,
    preferences.hiddenAccountIds ?? [],
    accountId,
  );
  if (decision.kind === "refuse") {
    return { error: decision.reason };
  }
  if (decision.kind === "switchTo") {
    const switched = await selectAccountLocked(
      deps.wallet,
      deps.session,
      deps.preferencesStore,
      decision.accountId,
    );
    if (!switched) {
      return { error: "wallet locked" };
    }
  }
  return null;
};

/**
 * Handles `wallet.setAccountHidden`. Revealing never needs a decision. Hiding
 * reads the vault and preferences inside one coordinator section, moves the
 * active account when it is the one being hidden, and only then records the
 * preference; a refusal writes nothing. Unknown ids are refused on hide, and
 * accepted on reveal so a stale id can still be cleared.
 */
export const handleSetAccountHidden = async (
  deps: AccountVisibilityDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readSetAccountHiddenInput(message);
  if (!input) {
    return { error: "invalid account visibility request" };
  }
  return runActiveStateMutation(deps.activeStateCoordinator, async () => {
    if (input.hidden) {
      const refusal = await prepareHide(deps, input.accountId);
      if (refusal) {
        return refusal;
      }
    }
    return { ok: true, preferences: await deps.preferencesStore.setAccountHidden(input) };
  });
};
