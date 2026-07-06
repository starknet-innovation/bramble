/**
 * Background-only unlock session. Passphrases stay in memory and expire quickly.
 */
import { WalletError } from "../shared/errors";
import { isVaultPassphrase } from "../storage/encrypted-store";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

const isValidTtl = (ttlMs: number): boolean =>
  Number.isSafeInteger(ttlMs) && ttlMs > 0 && ttlMs <= DEFAULT_TTL_MS;

/**
 * In-memory unlock session interface for background-only passphrase access.
 */
export type UnlockSession = {
  readonly getPassphrase: () => string | null;
  readonly isUnlocked: () => boolean;
  readonly lock: () => void;
  readonly unlock: (passphrase: string) => void;
};

/**
 * Creates an expiring background passphrase session.
 */
export const createUnlockSession = (
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now(),
): UnlockSession => {
  if (!isValidTtl(ttlMs)) {
    throw new WalletError("Invalid unlock session ttl");
  }

  let expiresAt = 0;
  let passphrase: string | null = null;

  const getPassphrase = (): string | null => {
    if (passphrase && now() <= expiresAt) {
      return passphrase;
    }
    passphrase = null;
    expiresAt = 0;
    return null;
  };

  return {
    getPassphrase,
    isUnlocked() {
      return getPassphrase() !== null;
    },
    lock() {
      passphrase = null;
      expiresAt = 0;
    },
    unlock(nextPassphrase) {
      if (!isVaultPassphrase(nextPassphrase)) {
        throw new WalletError("Invalid unlock session passphrase");
      }
      // ponytail: background memory session, replace with OS-backed unlock if needed.
      passphrase = nextPassphrase;
      expiresAt = now() + ttlMs;
    },
  };
};
