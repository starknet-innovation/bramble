/**
 * Pure origin-grant policy: what a connected site may currently see, and the
 * connected-sites list the permissions manager renders. Split out of
 * `vault-service.ts` (size budget) so the policy is one source of truth and is
 * testable without storage, clock, or randomness — a decrypted {@link Vault}
 * snapshot is the only input, nothing here performs I/O or throws, and the
 * results are deterministic (no locale-sensitive ordering).
 */
import type { Vault } from "../schema/schema";
import type { ConnectedSite } from "./service-types";

/**
 * Resolves the account ids `origin` is authorised to see right now: at most the
 * wallet's active account, never more.
 *
 * A grant records every account a site has ever been approved for, but the
 * wallet only ever hands it the account the user currently has selected:
 *
 * - the grant covers the active account — `[activeAccountId]`;
 * - no grant, no active account, or a grant that does not cover the active
 *   account — `[]`, so the site reads as disconnected until it is re-approved.
 *
 * One account in, one account out: approving a site again on a second account
 * accumulates ids in the stored grant but never widens what the page sees, so a
 * site can never correlate two of the user's accounts. Ids are returned
 * unresolved; the caller maps them to accounts.
 */
export const grantedAccountIdsFor = (vault: Vault, origin: string): readonly string[] => {
  const activeAccountId = vault.activeAccountId;
  if (activeAccountId === null) {
    return [];
  }
  const grant = vault.originGrants.find((stored) => stored.origin === origin);
  return grant?.accountIds.includes(activeAccountId) ? [activeAccountId] : [];
};

// Code-unit origin ordering. `localeCompare` would make the rendered order
// depend on the browser's locale; this module promises determinism instead.
const byOrigin = (left: ConnectedSite, right: ConnectedSite): number => {
  if (left.origin === right.origin) {
    return 0;
  }
  return left.origin < right.origin ? -1 : 1;
};

/**
 * Derives the connected-sites list (origin plus granted account count) from a
 * decrypted vault, ordered by origin for stable rendering. Reads the stored
 * grants directly, not {@link grantedAccountIdsFor}: the permissions manager
 * lists every site the user has ever authorised, and the account count is the
 * grant's history, independently of which account is active. Reused by the
 * connected-sites reader and by revocation responses.
 */
export const connectedSitesFromVault = (vault: Vault): readonly ConnectedSite[] =>
  vault.originGrants
    .map((grant) => ({ accountCount: grant.accountIds.length, origin: grant.origin }))
    .sort(byOrigin);
