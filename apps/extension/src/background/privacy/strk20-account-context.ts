/**
 * Shared protected-account boundary for dapp and extension-owned STRK20 flows.
 */

import { WalletError } from "@bramble/core/errors";
import {
  STRK20_SERVICE_UNAVAILABLE,
  type Strk20Service,
  unavailableStrk20Service,
} from "@bramble/privacy/service";
import type { WalletPreferences, WalletPreferencesStore } from "@bramble/settings/preferences";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { Call } from "starknet";
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
 * Whether a proof-bearing batch belongs on the STRK20 pool lane: it calls
 * `apply_actions` or touches the network's configured pool. Deliberately broad,
 * so a mis-addressed or unconfigured pool batch still meets the pool lane's
 * checks (which refuse it) rather than going out as a plain invoke proof.
 */
export const isPoolShapedBatch = (
  calls: readonly Call[],
  preferences: Pick<WalletPreferences, "strk20Networks">,
  networkId: StarknetNetworkId,
): boolean => {
  const pool = preferences.strk20Networks?.[networkId]?.poolAddress;
  return calls.some(
    (call) =>
      call.entrypoint === "apply_actions" ||
      (pool !== undefined && sameFelt(call.contractAddress, pool)),
  );
};

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
    isAuthorized: authorized.isCurrent,
    rpcUrls: resolved.rpcUrls,
    signHash: accountHashSigner(deps, resolved.account, resolved.passphrase),
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
