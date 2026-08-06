/**
 * Shared account lookup for validated decrypted vault snapshots.
 */
import { WalletError } from "../shared/errors";
import { type AccountRef, isAccountId, type Vault } from "../storage/vault-schema";

/**
 * Resolves one validated account id from a vault or fails with a stable error.
 */
export const findVaultAccount = (vault: Vault, accountId: string): AccountRef => {
  if (!isAccountId(accountId)) {
    throw new WalletError("Invalid account id");
  }
  const account = vault.accounts.find((stored) => stored.id === accountId);
  if (!account) {
    throw new WalletError("Account not found");
  }
  return account;
};
