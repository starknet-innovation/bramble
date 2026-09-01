/**
 * Shared protected-account boundary for dapp and extension-owned STRK20 flows.
 */

import { WalletError } from "@mc-wallet/core/errors";
import type { LedgerSignIntent, LedgerStrk20Intents } from "@mc-wallet/ledger-protocol/intent";
import {
  STRK20_SERVICE_UNAVAILABLE,
  type Strk20Service,
  unavailableStrk20Service,
} from "@mc-wallet/privacy/service";
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
 * `intents` labels the device prompts for a keyless Ledger account, so the pair
 * must match the operation this context is built for — build a separate context
 * rather than reusing one across operations that sign for different reasons
 * (registration versus authorizing a private action). Read-only operations
 * never reach either signer, so their intents are never shown.
 *
 * The two signers are separate because one operation takes two approvals for two
 * different things: `signHash` for the pool's CallSet authorization, and
 * `submitSignHash` for the broadcast or relay handoff that follows. Sharing one
 * signer between them is what once showed the same prompt twice.
 *
 * Both thunks are bound to the unlock the same way. `signHash` inherits the
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
  intents: LedgerStrk20Intents,
) => {
  const deriveViewingKey = deps.wallet.deriveStrk20ViewingKey;
  const config = resolved.preferences.strk20Networks?.[resolved.account.networkId] ?? null;
  const signerFor = (intent: LedgerSignIntent) =>
    accountHashSigner(deps, resolved.account, resolved.passphrase, intent);
  const authorized = captureSessionAuthorization(deps.session);
  const requireLiveSession = (): void => {
    if (!authorized.isCurrent()) {
      throw new WalletError("wallet locked");
    }
  };
  return {
    account: resolved.account,
    config,
    isAuthorized: authorized.isCurrent,
    rpcUrls: resolved.rpcUrls,
    signHash: signerFor(intents.authorize),
    submitSignHash: signerFor(intents.submit),
    viewingKey: async () => {
      // Checked before the vault is asked, so a locked wallet derives nothing
      // at all, and again before the key is returned, so a lock during
      // derivation revokes it instead of handing it to the SDK.
      requireLiveSession();
      // Each cause names itself. These three once shared one bare line with
      // several unrelated failures, and spelled it as a literal rather than the
      // shared constant, so a search for the constant could not even find them.
      if (!deriveViewingKey) {
        throw new WalletError(`${STRK20_SERVICE_UNAVAILABLE}: no viewing-key provider is wired`);
      }
      if (!config) {
        throw new WalletError(
          `${STRK20_SERVICE_UNAVAILABLE}: no privacy routing is configured for this network`,
        );
      }
      const poolAddress = canonicalFelt(config.poolAddress);
      if (!poolAddress) {
        throw new WalletError(
          `${STRK20_SERVICE_UNAVAILABLE}: the configured pool address is not a valid felt`,
        );
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
