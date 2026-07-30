/**
 * Vault-only STRK20 viewing-key derivation boundary.
 */
import type { KrustyKms } from "../crypto/krusty";
import { WalletError } from "../shared/errors";
import { isKeylessAccount, type Vault } from "../storage/vault-schema";
import { findVaultAccount } from "./vault-account";

/**
 * Derives a domain-separated privacy viewing key without exposing the account
 * signing key beyond Krusty. Keyless accounts fail closed.
 */
export const deriveVaultStrk20ViewingKey = async (
  kms: KrustyKms,
  vault: Vault,
  accountId: string,
): Promise<string> => {
  const account = findVaultAccount(vault, accountId);
  if (isKeylessAccount(account)) {
    throw new WalletError("STRK20 is unavailable for keyless accounts");
  }
  const signingKey = vault.signingKeys.find((key) => key.accountId === account.id);
  if (!signingKey) {
    throw new WalletError("Signing key unavailable");
  }
  return kms.deriveStrk20ViewingKey(signingKey.privateKey);
};
