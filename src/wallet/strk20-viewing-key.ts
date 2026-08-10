/**
 * Vault-only STRK20 viewing-key derivation boundary.
 */
import type { KrustyKms } from "../crypto/krusty";
import { WalletError } from "../shared/errors";
import { ledgerStrk20ViewingKeyFor } from "../storage/vault-account-secrets";
import { isKeylessAccount, type Vault } from "../storage/vault-schema";
import { findVaultAccount } from "./vault-account";

/**
 * Resolves a domain-separated privacy viewing key without exposing it beyond
 * the privileged vault boundary. Software accounts derive through Krusty;
 * Ledger accounts use only an exact chain/pool-scoped retained key.
 */
export const deriveVaultStrk20ViewingKey = async (
  kms: KrustyKms,
  vault: Vault,
  accountId: string,
  chainId: string,
  poolAddress: string,
): Promise<string> => {
  const account = findVaultAccount(vault, accountId);
  if (isKeylessAccount(account)) {
    const viewingKey = ledgerStrk20ViewingKeyFor(
      vault.accountSecrets,
      account.id,
      chainId,
      poolAddress,
    );
    if (!viewingKey) {
      throw new WalletError("Ledger STRK20 viewing key unavailable");
    }
    return viewingKey;
  }
  const signingKey = vault.signingKeys.find((key) => key.accountId === account.id);
  if (!signingKey) {
    throw new WalletError("Signing key unavailable");
  }
  return kms.deriveStrk20ViewingKey(signingKey.privateKey, chainId, poolAddress);
};
