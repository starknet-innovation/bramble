/**
 * Vault-only STRK20 viewing-key derivation boundary.
 */

import { WalletError } from "@bramble/core/errors";
import { isKeylessAccount } from "@bramble/wallet-model/accounts";
import type { KmsPort } from "../kms-port";
import type { Vault } from "../schema/schema";
import { ledgerStrk20ViewingKeyFor } from "./account-secrets";
import {
  type AccountDerivationInput,
  deriveAccount,
  deriveImportedAccount,
  type ImportedAccountInput,
  recoverStarkPublicKey,
} from "./accounts";
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

/**
 * The public viewing key this wallet would register for a not-yet-imported
 * phrase account in one pool, so discovery can compare it with the key the
 * pool already holds. The private viewing key and signing key stay inside
 * this call; only the public x-coordinate is returned. Throws on any
 * derivation or Krusty failure.
 */
export const previewStrk20ViewingPublicKey = async (
  kms: KmsPort,
  input: AccountDerivationInput & { readonly chainId: string; readonly poolAddress: string },
): Promise<string> => {
  const { chainId, poolAddress, ...derivation } = input;
  const { privateKey } = await deriveAccount(kms, derivation);
  const viewingKey = await kms.deriveStrk20ViewingKey(privateKey, chainId, poolAddress);
  return recoverStarkPublicKey(kms, viewingKey);
};

/**
 * The address a raw private key would import as, and the public viewing key
 * this wallet would register for it in one pool, both before anything is
 * stored. Neither the private key nor the viewing key leaves this call.
 * Throws on an invalid key or any Krusty failure.
 */
export const previewImportedStrk20ViewingPublicKey = async (
  kms: KmsPort,
  input: ImportedAccountInput & { readonly chainId: string; readonly poolAddress: string },
): Promise<{ readonly address: string; readonly viewingPublicKey: string }> => {
  const { chainId, poolAddress, ...imported } = input;
  const { account, privateKey } = await deriveImportedAccount(kms, imported);
  const viewingKey = await kms.deriveStrk20ViewingKey(privateKey, chainId, poolAddress);
  return {
    address: account.address,
    viewingPublicKey: await recoverStarkPublicKey(kms, viewingKey),
  };
};
