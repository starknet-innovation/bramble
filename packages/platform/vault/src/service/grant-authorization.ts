/**
 * Fail-closed authorization helpers for serialized origin-grant writes.
 */
import { WalletError } from "@mc-wallet/core/errors";

/**
 * Requires that the unlock capability which authorized a grant is current.
 * A stale or revoked capability fails before any durable vault mutation.
 */
export const requireGrantAuthorization = (isAuthorized: () => boolean): void => {
  if (!isAuthorized()) throw new WalletError("wallet locked");
};

/**
 * Restores the serialized pre-write snapshot when authorization expires while
 * the grant commit is in flight, then fails the caller closed.
 */
export const rollbackRevokedGrant = async (
  isAuthorized: () => boolean,
  rollback: () => Promise<void>,
): Promise<void> => {
  if (isAuthorized()) return;
  await rollback();
  throw new WalletError("wallet locked");
};
