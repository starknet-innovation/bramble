/**
 * Shared protected-account boundary for dapp and extension-owned STRK20 flows.
 */

import { WalletError } from "../shared/errors";
import { canonicalFelt, STARKNET_NETWORKS } from "../starknet/networks";
import { type Strk20Service, unavailableStrk20Service } from "../starknet/strk20/service";
import type { WalletPreferencesStore } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { accountHashSigner } from "./account-hash-signer";
import type { LedgerSignQueue } from "./ledger-sign-queue";
import type { RuntimeRpc } from "./runtime-rpc";
import type { WalletStatusReader } from "./wallet-reader";

/**
 * Resolves the injected STRK20 adapter, retaining the fail-closed default for
 * extension-owned and dapp-owned privacy operations.
 */
export const strk20ServiceForRuntime = (runtimeRpc: RuntimeRpc): Strk20Service =>
  runtimeRpc.strk20 ?? unavailableStrk20Service;

/**
 * Builds a lazy protected SDK context. Viewing-key derivation and signing do
 * not occur until an approved operation actually needs them.
 */
export const strk20AccountContext = (
  deps: {
    readonly ledgerSignQueue?: LedgerSignQueue;
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
  return {
    account: resolved.account,
    config,
    rpcUrls: resolved.rpcUrls,
    signHash: accountHashSigner(deps, resolved.account, resolved.passphrase),
    viewingKey: async () => {
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
      return deriveViewingKey({
        accountId: resolved.account.id,
        chainId: STARKNET_NETWORKS[resolved.account.networkId].chainId,
        poolAddress,
        vaultPassphrase: resolved.passphrase,
      });
    },
  };
};
