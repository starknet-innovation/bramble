/**
 * Pure origin-grant policy: what a connected site may currently see, and the
 * connected-sites list the permissions manager renders. Split out of
 * `vault-service.ts` (size budget) so the policy is one source of truth and is
 * testable without storage, clock, or randomness — a decrypted {@link Vault}
 * snapshot is the only input and nothing here performs I/O or throws.
 */
import type { Vault } from "../storage/vault-schema";
import type { ConnectedSite } from "./vault-service-types";

/**
 * Resolves the account ids `origin` is authorised to see right now.
 *
 * A grant records which accounts a site was ever approved for; the wallet's
 * active account decides which of them it may see *at this moment*, so the
 * dapp view always tracks the account the user has selected:
 *
 * - no grant for the origin — `[]`;
 * - the active account is in the grant — the granted ids with the active
 *   account first, the rest in their stored order;
 * - the active account is not in the grant (or none is selected) — `[]`, so
 *   the site reads as disconnected until the user re-approves it.
 *
 * This can only narrow what an origin sees relative to its stored grant, never
 * widen it. Ids are returned unresolved; the caller maps them to accounts.
 */
export const grantedAccountIdsFor = (vault: Vault, origin: string): readonly string[] => {
  const activeAccountId = vault.activeAccountId;
  const grant = vault.originGrants.find((stored) => stored.origin === origin);
  if (!grant || activeAccountId === null || !grant.accountIds.includes(activeAccountId)) {
    return [];
  }
  return [activeAccountId, ...grant.accountIds.filter((id) => id !== activeAccountId)];
};

/**
 * Derives the connected-sites list (origin plus granted account count) from a
 * decrypted vault, ordered by origin for stable rendering. Reads the stored
 * grants directly, not {@link grantedAccountIdsFor}: the permissions manager
 * lists every site the user has ever authorised, independently of which
 * account happens to be active. Reused by the connected-sites reader and by
 * revocation responses.
 */
export const connectedSitesFromVault = (vault: Vault): readonly ConnectedSite[] =>
  vault.originGrants
    .map((grant) => ({ accountCount: grant.accountIds.length, origin: grant.origin }))
    .sort((left, right) => left.origin.localeCompare(right.origin));
