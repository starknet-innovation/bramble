/**
 * Background-only unlock session. Passphrases stay in extension memory,
 * optionally mirrored to the extension's in-memory session storage so MV3
 * service-worker restarts do not lock the wallet, and expire on a rolling
 * inactivity window like standard wallets.
 */
import { WalletError } from "@mc-wallet/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { isVaultPassphrase } from "@mc-wallet/wallet-model/passphrase";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_TTL_MS = 8 * 60 * 60 * 1000;
const PERSIST_SLACK_MS = 60 * 1000;

const isValidTtl = (ttlMs: number): boolean =>
  Number.isSafeInteger(ttlMs) && ttlMs > 0 && ttlMs <= MAX_TTL_MS;

/**
 * Persisted unlock session snapshot.
 */
export type UnlockSessionState = {
  readonly expiresAt: number;
  readonly passphrase: string;
};

/**
 * Memory-only mirror used to survive MV3 service-worker restarts. Backed by
 * the extension's session storage area in production: never written to disk,
 * cleared when the browser exits.
 */
export type UnlockSessionStore = {
  readonly clear: () => Promise<void>;
  readonly load: () => Promise<unknown>;
  readonly save: (state: UnlockSessionState) => Promise<void>;
};

/**
 * Unlock session interface for background-only passphrase access.
 * `getPassphrase` renews the inactivity window and is for user-initiated
 * operations; `peekPassphrase` reads without renewing and is for passive
 * paths (status polling, event re-queries) so they can never hold the
 * wallet unlocked forever. `generation` returns a monotonic counter that
 * changes whenever the unlocked session boundary changes (a fresh unlock, or
 * any lock/expiry clear): a long-running operation that captured the value
 * when it started can re-check it before committing a side effect and fail
 * closed if the session it was authorized under is no longer current.
 */
export type UnlockSession = {
  readonly generation: () => number;
  readonly getPassphrase: () => string | null;
  readonly isUnlocked: () => boolean;
  readonly lock: () => void;
  readonly peekPassphrase: () => string | null;
  readonly restore: () => Promise<void>;
  readonly unlock: (passphrase: string) => void;
};

const isSessionState = (value: unknown): value is UnlockSessionState =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["expiresAt", "passphrase"]) &&
  typeof value["expiresAt"] === "number" &&
  Number.isSafeInteger(value["expiresAt"]) &&
  value["expiresAt"] > 0 &&
  typeof value["passphrase"] === "string" &&
  isVaultPassphrase(value["passphrase"]);

/**
 * Creates an expiring background passphrase session. Activity renews the
 * expiry, so the wallet only locks after `ttlMs` of real inactivity.
 */
export const createUnlockSession = (
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now(),
  store?: UnlockSessionStore,
  onClear?: () => void,
): UnlockSession => {
  if (!isValidTtl(ttlMs)) {
    throw new WalletError("Invalid unlock session ttl");
  }

  let expiresAt = 0;
  let passphrase: string | null = null;
  let persistedAt = 0;
  // Monotonic session-boundary counter. Bumped on every unlock and every clear
  // (lock or expiry), so a value captured while unlocked is only still current
  // if neither a lock nor a re-unlock has happened since. Never a clock/random
  // value — a plain incrementing integer keeps this module pure.
  let generationCounter = 0;

  const persist = (): void => {
    if (!store || passphrase === null) {
      return;
    }
    persistedAt = expiresAt;
    void store.save({ expiresAt, passphrase }).catch(() => undefined);
  };

  const clear = (): void => {
    expiresAt = 0;
    passphrase = null;
    persistedAt = 0;
    generationCounter += 1;
    void store?.clear().catch(() => undefined);
    // Drop any derived-key cache (e.g. the vault AES key) so locking or expiry
    // leaves no usable key material behind in worker memory.
    onClear?.();
  };

  // Reads the passphrase without renewing the inactivity window, clearing
  // expired state on the way so peeks never resurrect a stale unlock.
  const peekPassphrase = (): string | null => {
    if (passphrase && now() <= expiresAt) {
      return passphrase;
    }
    if (passphrase !== null) {
      clear();
    }
    return null;
  };

  const getPassphrase = (): string | null => {
    const current = peekPassphrase();
    if (current !== null) {
      expiresAt = now() + ttlMs;
      if (expiresAt - persistedAt >= PERSIST_SLACK_MS) {
        persist();
      }
    }
    return current;
  };

  return {
    generation() {
      return generationCounter;
    },
    getPassphrase,
    isUnlocked() {
      return peekPassphrase() !== null;
    },
    peekPassphrase,
    lock() {
      clear();
    },
    async restore() {
      if (!store || passphrase !== null) {
        return;
      }
      const stored = await store.load().catch(() => null);
      if (isSessionState(stored) && stored.expiresAt > now()) {
        passphrase = stored.passphrase;
        expiresAt = Math.min(stored.expiresAt, now() + ttlMs);
        persistedAt = stored.expiresAt;
      }
    },
    unlock(nextPassphrase) {
      if (!isVaultPassphrase(nextPassphrase)) {
        throw new WalletError("Invalid unlock session passphrase");
      }
      // ponytail: background memory session, replace with OS-backed unlock if needed.
      passphrase = nextPassphrase;
      expiresAt = now() + ttlMs;
      generationCounter += 1;
      persist();
    },
  };
};
