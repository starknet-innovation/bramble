/**
 * Shared account lookup for validated decrypted vault snapshots.
 */
import { WalletError } from "@bramble/core/errors";
import { type AccountRef, isAccountId } from "@bramble/wallet-model/accounts";
import type { Vault } from "../schema/schema";

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
