/**
 * Fail-closed authorization helpers for serialized origin-grant writes.
 */
import { WalletError } from "@bramble/core/errors";

/**
 * Requires that the unlock capability which authorized a grant is current.
 * Run before the vault is read and again right before its first storage write,
 * so a capability that lapses before the commit starts leaves nothing stored.
 */
export const requireGrantAuthorization = (isAuthorized: () => boolean): void => {
  if (!isAuthorized()) throw new WalletError("wallet locked");
};

/**
 * Restores the serialized pre-write snapshot when authorization expired during
 * the grant's storage writes, then fails the caller closed. The restore is a
 * second write, so it is best effort: if it fails, its storage error reaches
 * the caller instead of "wallet locked", and the user-approved grant remains;
 * a worker stopped between the two writes leaves it too (Sherlock 255).
 */
export const rollbackRevokedGrant = async (
  isAuthorized: () => boolean,
  rollback: () => Promise<void>,
): Promise<void> => {
  if (isAuthorized()) return;
  await rollback();
  throw new WalletError("wallet locked");
};
