/**
 * Records the shadow-account scopes an approved request uses, in the encrypted
 * vault, before the request runs (#443, PR 5). A scope is recorded when its
 * commitment is shared — a site can fund a precomputed address before the
 * account is ever deployed — and when a batch acts through it, with the exact
 * nonces, because sites choose nonces.
 *
 * Recording comes first and fails closed: a shadow account the wallet did not
 * record is one it cannot find again to sweep, so a request whose record cannot
 * be written does not run. The record holds the site's own label, never the
 * origin-bound separator, so the scope is re-derived exactly as the site's
 * requests are.
 */
import { WalletError } from "@bramble/core/errors";
import type { WalletPreferences } from "@bramble/settings/preferences";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { WalletStatusReader } from "../accounts/wallet-reader";

// Refusal when the vault cannot record a scope at all. Stable error code.
const SHADOW_ACCOUNT_RECORDS_UNAVAILABLE = "shadow account records unavailable";

/** One site label and the exact nonces a request uses under it. */
export type ShadowScopeUse = { readonly label: string; readonly nonces: readonly string[] };

/**
 * The scopes a batch acts through: one entry per distinct site label, with the
 * nonces of every `shadow_account_invoke` under it. Empty for a batch with no
 * shadow invoke. Reads the batch as the site sent it, before origin binding.
 */
export const shadowScopeUses = (actions: readonly Strk20Action[]): readonly ShadowScopeUse[] => {
  const byLabel = new Map<string, string[]>();
  for (const action of actions) {
    if (action.type === "shadow_account_invoke") {
      byLabel.set(action.dapp_name, [...(byLabel.get(action.dapp_name) ?? []), action.nonce]);
    }
  }
  return [...byLabel].map(([label, nonces]) => ({ label, nonces }));
};

/**
 * Writes every use into the encrypted vault for the resolved account's chain
 * and configured pool, under `anonymizer` and the verified `origin`. Throws a
 * {@link WalletError} when the vault cannot record, which the caller must let
 * stop the request.
 */
export const recordShadowScopeUses = async (
  wallet: Pick<WalletStatusReader, "recordShadowAccountScope">,
  resolved: {
    readonly account: AccountRef;
    readonly passphrase: string;
    readonly preferences: Pick<WalletPreferences, "strk20Networks">;
  },
  input: {
    readonly anonymizer: string;
    readonly origin: string;
    readonly uses: readonly ShadowScopeUse[];
  },
): Promise<void> => {
  const config = resolved.preferences.strk20Networks?.[resolved.account.networkId];
  if (!wallet.recordShadowAccountScope || !config) {
    throw new WalletError(SHADOW_ACCOUNT_RECORDS_UNAVAILABLE);
  }
  for (const use of input.uses) {
    await wallet.recordShadowAccountScope({
      accountId: resolved.account.id,
      anonymizer: input.anonymizer,
      chainId: STARKNET_NETWORKS[resolved.account.networkId].chainId,
      label: use.label,
      nonces: use.nonces,
      origin: input.origin,
      poolAddress: config.poolAddress,
      vaultPassphrase: resolved.passphrase,
    });
  }
};
