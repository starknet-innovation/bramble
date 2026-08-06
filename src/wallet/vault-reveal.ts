/** Privileged, re-authenticated vault-secret reveal boundary. */
import { WalletError } from "../shared/errors";
import type { Vault } from "../storage/vault-schema";
import type { RevealedSecrets } from "./vault-service-types";

/**
 * Extracts the active account's private key and recovery phrase. Missing
 * account/key state fails closed; callers must never persist or log the result.
 */
export const activeAccountSecrets = (vault: Vault): RevealedSecrets => {
  const accountId = vault.activeAccountId;
  if (!accountId) {
    throw new WalletError("No account selected");
  }
  const signingKey = vault.signingKeys.find((key) => key.accountId === accountId);
  if (!signingKey) {
    throw new WalletError("Signing key unavailable");
  }
  return { mnemonic: vault.mnemonic, privateKey: signingKey.privateKey };
};
