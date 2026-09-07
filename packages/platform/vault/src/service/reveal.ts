/** Privileged, re-authenticated vault-secret reveal boundary. */
import { WalletError } from "@bramble/core/errors";
import type { Vault } from "../schema/schema";
import type { RevealedSecrets } from "./service-types";

/**
 * Extracts the active account's private key and the recovery phrase that backs
 * it: an account derived from an imported seed reveals THAT seed's phrase (the
 * one that recovers it elsewhere), every other account reveals the founding
 * phrase. Missing account/key state and a dangling seed reference fail closed;
 * callers must never persist or log the result.
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
  const account = vault.accounts.find((stored) => stored.id === accountId);
  const seedId =
    account?.derivation.kind === "starknet-bip44" ? account.derivation.seedId : undefined;
  if (seedId === undefined) {
    return { mnemonic: vault.mnemonic, privateKey: signingKey.privateKey };
  }
  const seed = vault.importedSeeds.find((stored) => stored.id === seedId);
  if (!seed) {
    throw new WalletError("Imported seed unavailable");
  }
  return { mnemonic: seed.mnemonic, privateKey: signingKey.privateKey };
};
