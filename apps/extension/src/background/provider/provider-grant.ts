/**
 * Grant resolution for dapp requests: maps an origin's grant to its account on
 * the active network, failing closed on a locked wallet or a revoked grant.
 * Split from provider-ops.ts on the size budget; single source for the dapp
 * handlers and the held-approval executor so the fail-closed ordering never
 * drifts between them.
 */

import type { WalletPreferences, WalletPreferencesStore } from "@bramble/settings/preferences";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { ApprovalContext } from "../approvals/approval-context";
import type { ApprovalQueue } from "../approvals/approvals";
import { promptReconnectForStaleGrant } from "../approvals/reconnect-prompt";
import { captureSessionAuthorization, type PassiveUnlockSession } from "../runtime/session";

/**
 * The active-network account resolved for an origin's live connection grant,
 * together with the passphrase and preferences read while resolving it.
 */
export type ResolvedOriginAccount = {
  readonly account: AccountRef;
  readonly passphrase: string;
  readonly preferences: WalletPreferences;
};

/**
 * Dependencies needed to resolve an origin's active-network account. Both the
 * dapp handlers and the held-approval executor satisfy this shape.
 */
type GrantResolverDeps = {
  /**
   * Optional: fresh dapp requests queue a reconnect prompt through it when a
   * formerly granted origin no longer resolves. The held-approval executor
   * omits it (and pins `expected`), so post-consent execution never prompts.
   */
  readonly approvals?: ApprovalQueue;
  readonly preferencesStore: WalletPreferencesStore;
  readonly session: PassiveUnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * Resolves the account an origin's grant currently maps to on the active
 * network, or an error response the caller returns directly. A locked wallet
 * or a revoked grant fails safely; a fresh request (no pinned context) from a
 * formerly granted origin also queues a reconnect prompt beside the refusal.
 * Single source for the dapp handlers and the held-invoke executor so the
 * fail-closed ordering never drifts between them. Peek, never renew: an origin
 * that keeps calling must not be able to hold the wallet unlocked past its
 * inactivity limit.
 */
export const resolveOriginAccount = async (
  deps: GrantResolverDeps,
  origin: string,
  expected?: ApprovalContext,
): Promise<ResolvedOriginAccount | { readonly error: string }> => {
  const passphrase = deps.session.peekPassphrase();
  const authorized = captureSessionAuthorization(deps.session);
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const preferences = await deps.preferencesStore.read();
  if (!authorized.isCurrent()) return { error: "wallet locked" };
  if (expected && preferences.activeNetworkId !== expected.networkId) {
    return { error: "approval context changed" };
  }
  const granted = await deps.wallet.getGrantedAccounts(origin, passphrase);
  if (!authorized.isCurrent()) return { error: "wallet locked" };
  const account = expected
    ? granted.find(
        (stored) =>
          stored.id === expected.accountId &&
          stored.networkId === expected.networkId &&
          stored.networkId === preferences.activeNetworkId,
      )
    : granted.find((stored) => stored.networkId === preferences.activeNetworkId);
  if (!account) {
    // A fresh dapp request (no pinned context) from a formerly granted origin
    // surfaces a reconnect prompt beside the refusal, so the user sees WHY the
    // dapp is stuck instead of an eternal spinner. Held-approval execution
    // (expected context pinned) keeps the plain fail-closed refusal.
    if (!expected && deps.approvals) {
      promptReconnectForStaleGrant(deps.approvals, granted, origin);
    }
    return { error: "origin not connected" };
  }
  return { account, passphrase, preferences };
};

// Builds the fee-review target from a resolved grant. The signer is constructed
// here, where the vault credential already lives, so the estimator never
// receives one — and it is passed as a thunk so that construction happens inside
// the estimator's own failure handling rather than at the call site.
