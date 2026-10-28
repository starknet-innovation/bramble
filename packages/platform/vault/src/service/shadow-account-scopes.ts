/**
 * Vault service methods for the encrypted shadow-account scope records
 * (#443, PR 5). Split from ./service by behaviour. The records reveal which
 * sites an account used privately, so they are written and read only here and
 * returned only to the privileged background.
 */
import { RefusedBeforeWrite, WalletError } from "@bramble/core/errors";
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import {
  canonicalShadowAccountScope,
  SHADOW_ACCOUNT_RECORD_INVALID,
  SHADOW_ACCOUNT_RECORD_LIMIT,
  shadowAccountScopesFor,
  withShadowAccountScope,
} from "../accounts/shadow-account-scopes";
import { findVaultAccount } from "../accounts/vault-account";
import type { EncryptedStore } from "../encrypted-store";
import type { Vault } from "../schema/schema";
import { writeVault } from "./service-creation";
import type { WalletVaultService } from "./service-types";
import { requireVaultCapacity } from "./vault-capacity";

// Whether the vault with `shadowAccountScopes` would still fit its capacity,
// answered as the write would answer it but without touching storage.
const fitsVault = (vault: Vault, shadowAccountScopes: Vault["shadowAccountScopes"]): boolean => {
  try {
    requireVaultCapacity({ ...vault, shadowAccountScopes });
    return true;
  } catch (error) {
    if (error instanceof RefusedBeforeWrite) {
      return false;
    }
    throw error;
  }
};

/**
 * Builds the record and list methods over the vault's own read and write. The
 * caller serializes `recordShadowAccountScope` with every other mutation.
 */
export const shadowAccountScopeMethods = (
  encryptedStore: EncryptedStore,
  readVaultSnapshot: (vaultPassphrase: string) => Promise<Vault>,
): Pick<
  WalletVaultService,
  "canRecordShadowAccountScope" | "listShadowAccountScopes" | "recordShadowAccountScope"
> => ({
  async canRecordShadowAccountScope({ vaultPassphrase, ...input }) {
    const vault = await readVaultSnapshot(vaultPassphrase);
    const account = findVaultAccount(vault, input.accountId);
    const scope = canonicalShadowAccountScope(input);
    if (!scope || !sameFelt(scope.chainId, STARKNET_NETWORKS[account.networkId].chainId)) {
      throw new WalletError(SHADOW_ACCOUNT_RECORD_INVALID);
    }
    // Both the record bounds and the vault's own capacity, so a request whose
    // record the write would refuse is refused before approval (audit S1).
    const next = withShadowAccountScope(vault.shadowAccountScopes, scope);
    return next !== null && (next === vault.shadowAccountScopes || fitsVault(vault, next));
  },
  async listShadowAccountScopes(input) {
    const vault = await readVaultSnapshot(input.vaultPassphrase);
    const account = findVaultAccount(vault, input.accountId);
    return shadowAccountScopesFor(
      vault.shadowAccountScopes,
      account.id,
      input.chainId,
      input.poolAddress,
    );
  },
  async recordShadowAccountScope({ vaultPassphrase, ...input }) {
    const vault = await readVaultSnapshot(vaultPassphrase);
    const account = findVaultAccount(vault, input.accountId);
    const scope = canonicalShadowAccountScope(input);
    if (!scope || !sameFelt(scope.chainId, STARKNET_NETWORKS[account.networkId].chainId)) {
      throw new WalletError(SHADOW_ACCOUNT_RECORD_INVALID);
    }
    const shadowAccountScopes = withShadowAccountScope(vault.shadowAccountScopes, scope);
    if (!shadowAccountScopes) {
      throw new WalletError(SHADOW_ACCOUNT_RECORD_LIMIT);
    }
    if (shadowAccountScopes !== vault.shadowAccountScopes) {
      await writeVault(encryptedStore, { ...vault, shadowAccountScopes }, vaultPassphrase);
    }
  },
});
