/**
 * Vault-only STRK20 viewing-key derivation boundary.
 */

import { WalletError } from "@mc-wallet/core/errors";
import { isKeylessAccount } from "@mc-wallet/wallet-model/accounts";
import type { KmsPort } from "../kms-port";
import type { Vault } from "../schema/schema";
import { ledgerStrk20ViewingKeyFor } from "./account-secrets";
import { findVaultAccount } from "./vault-account";

/**
 * Resolves a domain-separated privacy viewing key without exposing it beyond
 * the privileged vault boundary. Software accounts derive through Krusty;
 * Ledger accounts use only an exact chain/pool-scoped retained key.
 */
export const deriveVaultStrk20ViewingKey = async (
  kms: KmsPort,
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
