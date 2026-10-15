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
import { SHADOW_ACCOUNT_RECORDS_UNAVAILABLE } from "@bramble/privacy/shadow-account-refusals";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { SHADOW_ACCOUNT_RECORD_LIMIT } from "@bramble/vault/shadow-account-scopes";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { Strk20DisclosureRequest } from "./strk20-approval-types";

/** One site label and the exact nonces a request uses under it. */
export type ShadowScopeUse = { readonly label: string; readonly nonces: readonly string[] };

/**
 * The scopes a batch acts through: one entry per distinct site label, with the
 * nonces of every `shadow_account_invoke` under it. Empty for a batch with no
 * shadow invoke. Reads the batch as the site sent it, before origin binding.
 */
const shadowScopeUses = (actions: readonly Strk20Action[]): readonly ShadowScopeUse[] => {
  const byLabel = new Map<string, string[]>();
  for (const action of actions) {
    if (action.type === "shadow_account_invoke") {
      byLabel.set(action.dapp_name, [...(byLabel.get(action.dapp_name) ?? []), action.nonce]);
    }
  }
  return [...byLabel].map(([label, nonces]) => ({ label, nonces }));
};

/** The anonymizer and scope uses a request records when it runs. */
export type ShadowScopeRecording = {
  readonly anonymizer: string;
  readonly uses: readonly ShadowScopeUse[];
};

/**
 * What a batch records before it runs: its shadow invokes' scopes under the
 * anonymizer the card named, or null when it names none (no shadow invoke).
 */
export const invokeScopeRecording = (
  anonymizer: string | undefined,
  actions: readonly Strk20Action[],
): ShadowScopeRecording | null =>
  anonymizer === undefined ? null : { anonymizer, uses: shadowScopeUses(actions) };

/**
 * What an approved disclosure records before it runs, or null when it records
 * nothing: a submittable proof with a shadow invoke records its scopes (a
 * simulation cannot act through one), and a commitment records its scope —
 * when it is shared, not only on invoke, since a site can fund the
 * precomputed address before the shadow account is deployed.
 */
export const disclosureScopeRecording = (
  request: Strk20DisclosureRequest,
): ShadowScopeRecording | null => {
  if (request.type === "prepare") {
    return request.simulate ? null : invokeScopeRecording(request.anonymizer, request.actions);
  }
  if (request.type === "shadowAccount") {
    const nonces = request.nonce === undefined ? [] : [request.nonce];
    return { anonymizer: request.anonymizer, uses: [{ label: request.dappName, nonces }] };
  }
  return null;
};

/**
 * Whether every use could be recorded now, checked before the request is
 * queued so the user is not asked to approve a request the record bound will
 * refuse (audit F9). Advisory: true when the wallet cannot pre-check (partial
 * test stubs) or the check itself fails, because {@link recordShadowScopeUses}
 * still runs after approval and fails closed. Writes nothing.
 */
const canRecordShadowScopeUses = async (
  wallet: Pick<WalletStatusReader, "canRecordShadowAccountScope">,
  resolved: Parameters<typeof recordShadowScopeUses>[1],
  input: Parameters<typeof recordShadowScopeUses>[2],
): Promise<boolean> => {
  const config = resolved.preferences.strk20Networks?.[resolved.account.networkId];
  if (!wallet.canRecordShadowAccountScope || !config) {
    return true;
  }
  for (const use of input.uses) {
    const accepted = await wallet
      .canRecordShadowAccountScope({
        accountId: resolved.account.id,
        anonymizer: input.anonymizer,
        chainId: STARKNET_NETWORKS[resolved.account.networkId].chainId,
        label: use.label,
        nonces: use.nonces,
        origin: input.origin,
        poolAddress: config.poolAddress,
        vaultPassphrase: resolved.passphrase,
      })
      .catch(() => true);
    if (!accepted) {
      return false;
    }
  }
  return true;
};

/**
 * The refusal for a request whose record the vault's bound would refuse, or
 * null. Run before the request is queued, it answers exactly as the record
 * would after approval, so the user is never asked to approve a request that
 * can only fail. Null for a request that records nothing.
 */
export const shadowRecordRefusal = async (
  wallet: Pick<WalletStatusReader, "canRecordShadowAccountScope">,
  resolved: Parameters<typeof recordShadowScopeUses>[1],
  origin: string,
  recording: ShadowScopeRecording | null,
): Promise<{ readonly error: string } | null> =>
  recording === null || (await canRecordShadowScopeUses(wallet, resolved, { ...recording, origin }))
    ? null
    : { error: SHADOW_ACCOUNT_RECORD_LIMIT };

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
