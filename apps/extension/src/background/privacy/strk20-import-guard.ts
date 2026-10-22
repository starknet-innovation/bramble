/**
 * Refuses importing an account another wallet registered with the privacy
 * pool. The pool writes an address's viewing key once and never replaces it,
 * so an account registered under a key this wallet does not derive can never
 * shield or unshield here. Reads only public chain state; fails closed.
 */

import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import {
  canonicalFelt,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { RecoveryPrivacyPoolBlock } from "@bramble/wallet-model/recovery";
import type { RuntimeRpc } from "../runtime/runtime-rpc";

/** The configured privacy pool an import is checked against. */
export type Strk20ImportPool = { readonly chainId: string; readonly poolAddress: string };

/**
 * Background refusals for a single-account import, keyed by block reason. The
 * panel translates each through its friendly-error table.
 */
export const STRK20_IMPORT_REFUSALS: Readonly<Record<RecoveryPrivacyPoolBlock, string>> = {
  "registered-elsewhere": "account registered for privacy in another wallet",
  unchecked: "privacy registration unavailable",
};

/**
 * The network's configured privacy pool, or null when it has none — an
 * account cannot be registered with a pool that is not there.
 */
export const strk20ImportPool = (
  preferences: Awaited<ReturnType<WalletPreferencesStore["read"]>>,
  networkId: StarknetNetworkId,
): Strk20ImportPool | null => {
  const configured = preferences.strk20Networks?.[networkId]?.poolAddress;
  const poolAddress = configured === undefined ? null : canonicalFelt(configured);
  return poolAddress ? { chainId: STARKNET_NETWORKS[networkId].chainId, poolAddress } : null;
};

/**
 * Why an account may not be imported, or null to proceed. `ownViewingPublicKey`
 * derives the key this wallet would register; null means this wallet never
 * registers such an account (Ledger today), so any registration is another
 * wallet's. An unreadable pool, a missing reader, or a failed derivation
 * answers `unchecked`: the import is refused until the check succeeds.
 */
export const strk20ImportBlock = async (input: {
  readonly address: string;
  readonly ownViewingPublicKey: (() => Promise<string>) | null;
  readonly pool: Strk20ImportPool | null;
  readonly readRegistered: RuntimeRpc["getStrk20PublicKey"];
  readonly rpcUrls: readonly string[];
}): Promise<RecoveryPrivacyPoolBlock | null> => {
  const { address, ownViewingPublicKey, pool, readRegistered, rpcUrls } = input;
  if (!pool) return null;
  if (!readRegistered) return "unchecked";
  try {
    const registered = await readRegistered({ address, poolAddress: pool.poolAddress, rpcUrls });
    if (BigInt(registered) === 0n) return null;
    if (!ownViewingPublicKey) return "registered-elsewhere";
    return sameFelt(registered, await ownViewingPublicKey()) ? null : "registered-elsewhere";
  } catch {
    return "unchecked";
  }
};
