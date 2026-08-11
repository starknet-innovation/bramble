/**
 * Stateful origin-grant operations: granting a site access, resolving what it
 * may currently see, and revoking it.
 *
 * Split from `vault-service.ts` (size budget) with storage injected as `io`,
 * which keeps the policy in `./origin-grants` genuinely pure — that module
 * documents itself as performing no I/O, so the read-modify-write half belongs
 * here rather than being added alongside it.
 *
 * The caller owns mutation serialization: `grantOriginAccess` and
 * `revokeOriginAccess` are read-modify-writes of the whole vault, so the vault
 * service runs them inside its mutation queue. Nothing here retries or
 * serializes on its own.
 */

import { WalletError } from "../shared/errors";
import { isWalletOrigin } from "../shared/origin";
import type { AccountRef, Vault } from "../storage/vault-schema";
import { connectedSitesFromVault, grantedAccountIdsFor } from "./origin-grants";
import { findVaultAccount } from "./vault-account";
import type { ConnectedSite, OriginGrantInput, RevokeOriginInput } from "./vault-service-types";

/**
 * Vault access these operations need, injected so this module performs no
 * storage or crypto of its own.
 *
 * `readVault` is the passive read (it may trigger a KDF upgrade write);
 * `readVaultSnapshot` is the read a mutation modifies. They are separate entries
 * because mixing them up is what turns a grant into a lost write.
 */
export type VaultOriginIo = {
  readonly readVault: (vaultPassphrase: string) => Promise<Vault>;
  readonly readVaultSnapshot: (vaultPassphrase: string) => Promise<Vault>;
  readonly writeVault: (vault: Vault, vaultPassphrase: string) => Promise<void>;
};

/**
 * Grants `origin` access to one account and returns just that account.
 *
 * Defaults to the vault's active account. Returns the single granted account
 * rather than every id the grant has accumulated, so a site is never handed a
 * second account it could correlate with the first. Rejects an invalid origin
 * and a missing account before writing anything.
 */
export const grantOriginAccess = async (
  io: VaultOriginIo,
  input: OriginGrantInput,
): Promise<readonly AccountRef[]> => {
  if (!isWalletOrigin(input.origin)) {
    throw new WalletError("Invalid origin");
  }
  const vault = await io.readVaultSnapshot(input.vaultPassphrase);
  const accountId = input.accountId ?? vault.activeAccountId;
  if (!accountId) {
    throw new WalletError("No account selected");
  }
  const account = findVaultAccount(vault, accountId);
  const grants = vault.originGrants.filter((grant) => grant.origin !== input.origin);
  const existing = vault.originGrants.find((grant) => grant.origin === input.origin);
  const accountIds = [...new Set([...(existing?.accountIds ?? []), account.id])];
  await io.writeVault(
    { ...vault, originGrants: [...grants, { accountIds, origin: input.origin }] },
    input.vaultPassphrase,
  );
  return [account];
};

/**
 * Resolves the accounts `origin` may see right now, per the pure grant policy.
 * Rejects an invalid origin and performs no write.
 */
export const grantedAccountsFor = async (
  io: VaultOriginIo,
  origin: string,
  vaultPassphrase: string,
): Promise<readonly AccountRef[]> => {
  if (!isWalletOrigin(origin)) {
    throw new WalletError("Invalid origin");
  }
  const vault = await io.readVault(vaultPassphrase);
  return grantedAccountIdsFor(vault, origin).map((accountId) => findVaultAccount(vault, accountId));
};

/**
 * Revokes `origin` and returns the remaining connected sites.
 *
 * Writes only when a grant was actually removed, so revoking an already-revoked
 * origin re-encrypts nothing. The returned list is computed from the post-write
 * state either way, so the caller's view matches storage.
 */
export const revokeOriginAccess = async (
  io: VaultOriginIo,
  input: RevokeOriginInput,
): Promise<readonly ConnectedSite[]> => {
  if (!isWalletOrigin(input.origin)) {
    throw new WalletError("Invalid origin");
  }
  const vault = await io.readVaultSnapshot(input.vaultPassphrase);
  const originGrants = vault.originGrants.filter((grant) => grant.origin !== input.origin);
  if (originGrants.length !== vault.originGrants.length) {
    await io.writeVault({ ...vault, originGrants }, input.vaultPassphrase);
  }
  return connectedSitesFromVault({ ...vault, originGrants });
};
