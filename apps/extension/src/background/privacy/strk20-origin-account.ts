/**
 * Origin-to-account resolution shared by the STRK20 request handlers and the
 * appliers that run after approval. Single-sourced so the two halves cannot
 * drift into disagreeing about which account a connected site may act as.
 *
 * The unlocked vault passphrase transits this module into the caller's protected
 * signer wiring; it is never logged, persisted, or returned across a boundary.
 */

import { WalletError } from "@mc-wallet/core/errors";
import { STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import type { WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { ApprovalContext } from "../approvals/approval-context";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { UnlockSession } from "../runtime/session";
import type { WalletStatusReader } from "../accounts/wallet-reader";

/**
 * One connected origin's resolved account and the state needed to act as it.
 */
export type ResolvedAccount = {
  readonly account: AccountRef;
  readonly passphrase: string;
  readonly preferences: Awaited<ReturnType<WalletPreferencesStore["read"]>>;
  readonly rpcUrls: readonly string[];
};

/**
 * Sanitizes an error for the provider bridge: known STRK20 errors carry a stable
 * message that maps to a spec code on the wire, and anything else collapses to a
 * generic failure (UNKNOWN_ERROR) rather than leaking an internal reason.
 */
export const strk20ErrorMessage = (error: unknown): string =>
  error instanceof WalletError ? error.message : "strk20 request failed";

/**
 * Resolves the origin's active-network account, or an error response the caller
 * can return directly. A locked wallet, a revoked grant, or a network changed
 * since the reviewed approval all fail safely with no private state touched.
 *
 * Passing `expected` binds the result to a specific reviewed approval context,
 * which is what makes an applier refuse to act as a different account than the
 * one the user saw.
 */
export const resolveAccount = async (
  deps: {
    readonly preferencesStore: WalletPreferencesStore;
    readonly session: UnlockSession;
    readonly wallet: WalletStatusReader;
  },
  origin: string,
  expected?: ApprovalContext,
): Promise<ResolvedAccount | { readonly error: string }> => {
  const passphrase = deps.session.getPassphrase();
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const preferences = await deps.preferencesStore.read();
  if (expected && preferences.activeNetworkId !== expected.networkId) {
    return { error: "approval context changed" };
  }
  const granted = await deps.wallet.getGrantedAccounts(origin, passphrase);
  const account = expected
    ? granted.find(
        (stored) =>
          stored.id === expected.accountId &&
          stored.networkId === expected.networkId &&
          stored.networkId === preferences.activeNetworkId,
      )
    : granted.find((stored) => stored.networkId === preferences.activeNetworkId);
  if (!account) {
    return { error: "origin not connected" };
  }
  return {
    account,
    passphrase,
    preferences,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences),
  };
};
