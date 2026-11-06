/**
 * Re-resolves the account a typed-data approval may sign for. A lock during
 * the read, or a grant that no longer covers the origin, fails closed.
 */

import type { MultisigStore } from "@bramble/multisig/repository";
import type { WalletPreferences, WalletPreferencesStore } from "@bramble/settings/preferences";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { ApprovalContext } from "../approvals/approval-context";
import { type GrantedDappAccount, grantedDappAccounts } from "../provider/dapp-account";
import type { MultisigOriginGrantStore } from "../provider/multisig-grants";
import { captureSessionAuthorization, type PassiveUnlockSession } from "../runtime/session";

type SignGrant =
  | { readonly error: string }
  | {
      readonly account: GrantedDappAccount;
      readonly authorized: ReturnType<typeof captureSessionAuthorization>;
      readonly passphrase: string;
      readonly preferences: WalletPreferences;
    };

/**
 * The account this origin may sign with, plus the authorization captured
 * before the vault read. Callers re-check `authorized` after later awaits.
 */
export const resolveSignGrant = async (
  deps: {
    readonly multisigGrants?: MultisigOriginGrantStore;
    readonly multisigStore?: Pick<MultisigStore, "listMultisigs">;
    readonly preferencesStore: Pick<WalletPreferencesStore, "read">;
    readonly session: PassiveUnlockSession;
    readonly wallet: Pick<WalletStatusReader, "getGrantedAccounts">;
  },
  input: { readonly context?: ApprovalContext; readonly origin: string },
): Promise<SignGrant> => {
  const passphrase = deps.session.peekPassphrase();
  const authorized = captureSessionAuthorization(deps.session);
  if (!passphrase) return { error: "wallet locked" };
  const preferences = await deps.preferencesStore.read();
  if (input.context && preferences.activeNetworkId !== input.context.networkId) {
    return { error: "approval context changed" };
  }
  const granted = await grantedDappAccounts(deps, input.origin, passphrase);
  if (!authorized.isCurrent()) return { error: "wallet locked" };
  const account = input.context
    ? granted.find(
        (stored) =>
          stored.id === input.context?.accountId &&
          stored.networkId === input.context.networkId &&
          stored.networkId === preferences.activeNetworkId,
      )
    : granted.find((stored) => stored.networkId === preferences.activeNetworkId);
  return account
    ? { account, authorized, passphrase, preferences }
    : { error: "origin not connected" };
};
