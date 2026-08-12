/**
 * Shared protected-account boundary for dapp and extension-owned STRK20 flows.
 */

import { WalletError } from "@mc-wallet/core/errors";
import { type Strk20Service, unavailableStrk20Service } from "@mc-wallet/privacy/service";
import type { WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { canonicalFelt, STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { accountHashSigner } from "../ledger/account-hash-signer";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { captureSessionAuthorization, type PassiveUnlockSession } from "../runtime/session";

/**
 * Resolves the injected STRK20 adapter, retaining the fail-closed default for
 * extension-owned and dapp-owned privacy operations.
 */
export const strk20ServiceForRuntime = (runtimeRpc: RuntimeRpc): Strk20Service =>
  runtimeRpc.strk20 ?? unavailableStrk20Service;

/**
 * Builds a lazy protected SDK context. Viewing-key derivation and signing do
 * not occur until an approved operation actually needs them. `session` is the
 * unlock that authorized the operation and is required: it binds BOTH returned
 * thunks to that unlock, so a private transfer signed here and a private
 * balance disclosed here fail closed once the user locks, exactly as the public
 * transaction paths do.
 *
 * The two thunks are deliberately bound the same way. `signHash` inherits the
 * boundary from {@link accountHashSigner}; `viewingKey` re-checks the same
 * captured authorization before it asks the vault and again before it hands the
 * key to the SDK, because an approved disclosure reaches for the key late —
 * inside network work — and a lock issued in that window must revoke it rather
 * than watch it complete. Both raise `wallet locked`.
 */
export const strk20AccountContext = (
  deps: {
    readonly ledgerSignQueue?: LedgerSignQueue;
    readonly session: PassiveUnlockSession;
    readonly wallet: WalletStatusReader;
  },
  resolved: {
    readonly account: AccountRef;
    readonly passphrase: string;
    readonly preferences: Awaited<ReturnType<WalletPreferencesStore["read"]>>;
    readonly rpcUrls: readonly string[];
  },
) => {
  const deriveViewingKey = deps.wallet.deriveStrk20ViewingKey;
  const config = resolved.preferences.strk20Networks?.[resolved.account.networkId] ?? null;
  const authorized = captureSessionAuthorization(deps.session);
  const requireLiveSession = (): void => {
    if (!authorized.isCurrent()) {
      throw new WalletError("wallet locked");
    }
  };
  return {
    account: resolved.account,
    config,
    rpcUrls: resolved.rpcUrls,
    signHash: accountHashSigner(deps, resolved.account, resolved.passphrase),
    viewingKey: async () => {
      // Checked before the vault is asked, so a locked wallet derives nothing
      // at all, and again before the key is returned, so a lock during
      // derivation revokes it instead of handing it to the SDK.
      requireLiveSession();
      if (!deriveViewingKey) {
        throw new WalletError("strk20 services unavailable");
      }
      if (!config) {
        throw new WalletError("strk20 services unavailable");
      }
      const poolAddress = canonicalFelt(config.poolAddress);
      if (!poolAddress) {
        throw new WalletError("strk20 services unavailable");
      }
      const viewingKey = await deriveViewingKey({
        accountId: resolved.account.id,
        chainId: STARKNET_NETWORKS[resolved.account.networkId].chainId,
        poolAddress,
        vaultPassphrase: resolved.passphrase,
      });
      requireLiveSession();
      return viewingKey;
    },
  };
};
