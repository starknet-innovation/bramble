/**
 * Privileged recovery-phrase account scan: which HD accounts this vault's phrase
 * already has on chain, so a restored wallet can offer them back instead of
 * coming up empty.
 *
 * The phrase is never accepted from a message and never returned — it is read
 * inside the vault service, and only public account metadata crosses back. The
 * network comes from wallet state and the passphrase from the unlock session, so
 * a caller cannot redirect a scan at a network or vault it does not hold.
 *
 * Chain reads run here rather than in the wallet layer: the walk needs RPC, and
 * `src/wallet` stays free of network access.
 */

import { STARKNET_NETWORKS } from "../starknet/networks";
import { discoveryTokensForNetwork } from "../starknet/token-registry";
import type { WalletPreferencesStore } from "../storage/preferences-store";
import { readTypeOnlyInput } from "./message-inputs";
import type { RuntimeRpc } from "./runtime-rpc";
import { networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse, SeedScanCandidateView } from "./runtime-types";
import type { UnlockSession } from "./session";
import type { WalletStatusReader } from "./wallet-reader";

/**
 * Dependencies for the recovery-phrase scan handler.
 */
export type SeedScanOpsDeps = {
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

// Balances are read only for an address that is not deployed. A deployed account
// already qualifies, so reading its balances would buy nothing and cost one RPC
// call per token — the common case is a deployed account, so this is most of the
// scan's cost.
const probeAddress =
  (deps: SeedScanOpsDeps, networkId: string, rpcUrls: readonly string[]) =>
  async (address: string) => {
    const deployed = await deps.runtimeRpc.getDeploymentStatus({
      accountAddress: address,
      rpcUrls,
    });
    if (deployed) {
      return { deployed: true, funded: false };
    }
    const balances = await deps.runtimeRpc.getTokenBalances({
      accountAddress: address,
      rpcUrls,
      tokens: discoveryTokensForNetwork(
        STARKNET_NETWORKS[networkId as keyof typeof STARKNET_NETWORKS].id,
      ),
    });
    return {
      deployed: false,
      funded: balances.some(
        (balance) => /^\d+$/.test(balance.balance) && BigInt(balance.balance) > 0n,
      ),
    };
  };

/**
 * Handles `wallet.scanSeedAccounts` and returns null for other message types.
 *
 * Fails closed on a locked wallet, a vault with no stored phrase, and an
 * unreachable node — reporting "no accounts found" because a node was down would
 * invite the user to conclude their accounts are gone.
 */
export const handleSeedScanOps = async (
  deps: SeedScanOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType !== "wallet.scanSeedAccounts") {
    return null;
  }
  if (!readTypeOnlyInput(message, "wallet.scanSeedAccounts")) {
    return { error: "invalid seed scan request" };
  }
  const vaultPassphrase = deps.session.getPassphrase();
  if (!vaultPassphrase) {
    return { error: "wallet locked" };
  }
  const scan = deps.wallet.scanSeedAccounts;
  if (!scan) {
    return { error: "wallet unavailable" };
  }
  const preferences = await deps.preferencesStore.read();
  const networkId = preferences.activeNetworkId;
  const network = STARKNET_NETWORKS[networkId];
  try {
    const vault = await deps.wallet.readVault(vaultPassphrase);
    const existing = new Set(vault.accounts.map((account) => account.id));
    const candidates = await scan({
      networkId,
      probe: probeAddress(deps, networkId, networkRpcUrls(network, preferences)),
      vaultPassphrase,
    });
    return {
      candidates: candidates.map(
        (candidate): SeedScanCandidateView => ({
          accountIndex: candidate.accountIndex,
          address: candidate.account.address,
          alreadyAdded: existing.has(candidate.account.id),
          deployed: candidate.deployed,
          funded: candidate.funded,
        }),
      ),
      ok: true,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not scan for accounts" };
  }
};
