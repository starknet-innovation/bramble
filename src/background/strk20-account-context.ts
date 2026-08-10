/**
 * Shared protected-account boundary for dapp and extension-owned STRK20 flows.
 */

import { WalletError } from "../shared/errors";
import type { LedgerSignIntent, LedgerStrk20Intents } from "../starknet/ledger-intent";
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
  intents: LedgerStrk20Intents,
) => {
  const deriveViewingKey = deps.wallet.deriveStrk20ViewingKey;
  const config = resolved.preferences.strk20Networks?.[resolved.account.networkId] ?? null;
  const signerFor = (intent: LedgerSignIntent) =>
    accountHashSigner(deps, resolved.account, resolved.passphrase, intent);
  return {
    account: resolved.account,
    config,
    rpcUrls: resolved.rpcUrls,
    signHash: signerFor(intents.authorize),
    submitSignHash: signerFor(intents.submit),
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
