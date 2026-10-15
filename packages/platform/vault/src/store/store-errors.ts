/**
 * The errors a vault read throws when it refuses an envelope, and the health
 * each one means. Single-sourced because the store, its freshness authorities,
 * the downgrade marker and the background's unlock path all name them, and a
 * message that drifts in one place silently changes what the wallet reports.
 */
import { WalletError } from "@bramble/core/errors";

/** Message of the error a read throws when no authority holds a commit record for the envelope. */
export const COMMIT_STATE_MISSING = "Encrypted store commit state missing";
/** Message of the error a read throws when an authority names a different commit. */
export const ROLLBACK_DETECTED = "Encrypted store rollback detected";
/** Message of the error a read throws when a commit record or marker is malformed. */
export const INVALID_COMMIT_STATE = "Invalid encrypted store commit state";
/** Message of the error a read throws when the stored envelope is malformed. */
export const INVALID_ENVELOPE = "Invalid encrypted store envelope";

/**
 * Whether the stored envelope can be opened, decided without the password:
 * `absent` when nothing is stored; `unverified` when no authority holds its
 * commit record; `rollback` when an authority names a different commit or its
 * record is malformed; `invalid` when the envelope itself is malformed.
 */
export type EncryptedStoreHealth = "absent" | "invalid" | "ok" | "rollback" | "unverified";

/** The health states a user may recover from by accepting a possibly older copy. */
export const UNVERIFIED_HEALTH: ReadonlySet<EncryptedStoreHealth> = new Set([
  "rollback",
  "unverified",
]);

/** Maps a read failure to the health it means, or undefined for any other error. */
export const healthFor = (error: unknown): EncryptedStoreHealth | undefined => {
  if (!(error instanceof WalletError)) {
    return undefined;
  }
  switch (error.message) {
    case COMMIT_STATE_MISSING:
      return "unverified";
    case ROLLBACK_DETECTED:
    case INVALID_COMMIT_STATE:
      return "rollback";
    case INVALID_ENVELOPE:
      return "invalid";
    default:
      return undefined;
  }
};
