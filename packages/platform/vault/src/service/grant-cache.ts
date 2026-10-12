/**
 * The origin-grant projection, kept in memory between vault writes so a dapp's
 * passive grant query answers without decrypting the vault (Sherlock 135).
 *
 * `mc_accounts`, `wallet_getPermissions` and a silent `wallet_requestAccounts`
 * return the same empty result to an unconnected site whether the wallet is
 * locked or not, but the locked answer returned at once while the unlocked one
 * waited on a full vault read. The latency told any page the lock state. With
 * this cache the unlocked answer is a map lookup too.
 *
 * Holds only what grant resolution reads: the active account, the grants and
 * the public account records. Never a phrase, key or other secret.
 * Correctness rests on invalidation: every call that can change the stored
 * vault bumps the generation before and after it runs, and a read only fills
 * the cache when no write started or finished while it was in flight. The
 * entry is bound to the password it was read with, so a wrong password never
 * reads it, and `clear` drops it when the wallet locks.
 */

import type { EncryptedStore } from "../encrypted-store";
import type { Vault } from "../schema/schema";

// The part of a decrypted vault that grant resolution reads.
type GrantProjection = Pick<Vault, "accounts" | "activeAccountId" | "originGrants">;

/** In-memory grant projection with write-driven invalidation. */
export type GrantCache = {
  /** Drops the entry and invalidates any read in flight. */
  readonly clear: () => void;
  /** The current generation, captured before a read starts. */
  readonly generation: () => number;
  /** The cached projection for `password`, if it is still current. */
  readonly lookup: (password: string) => GrantProjection | undefined;
  /** Stores a projection read under `password`, unless a write intervened. */
  readonly remember: (password: string, vault: Vault, startedAt: number) => void;
  /** Wraps a store so every call that can change it invalidates the cache. */
  readonly watch: (store: EncryptedStore) => EncryptedStore;
};

/**
 * Creates an empty grant cache.
 */
export const createGrantCache = (): GrantCache => {
  let current = 0;
  let entry:
    | { readonly generation: number; readonly password: string; readonly vault: GrantProjection }
    | undefined;
  const clear = (): void => {
    current += 1;
    entry = undefined;
  };
  const invalidating =
    <A extends unknown[]>(run: (...args: A) => Promise<void>) =>
    async (...args: A): Promise<void> => {
      clear();
      try {
        await run(...args);
      } finally {
        clear();
      }
    };
  return {
    clear,
    generation: () => current,
    lookup: (password) =>
      entry && entry.generation === current && entry.password === password
        ? entry.vault
        : undefined,
    remember(password, vault, startedAt) {
      if (startedAt !== current) {
        return;
      }
      entry = {
        generation: current,
        password,
        vault: {
          accounts: vault.accounts,
          activeAccountId: vault.activeAccountId,
          originGrants: vault.originGrants,
        },
      };
    },
    // Every member is listed, with no spread, so a method added to
    // `EncryptedStore` fails to compile here until it is classified as a read
    // or a write.
    watch: (store) => ({
      clearKeys: () => {
        clear();
        store.clearKeys();
      },
      exists: () => store.exists(),
      // Can repair commit records, never the vault's content or its grants.
      health: () => store.health(),
      read: (password) => store.read(password),
      readUnverified: (password) => store.readUnverified(password),
      remove: invalidating(() => store.remove()),
      // Rewrites the vault with its grants removed.
      replaceUnverified: invalidating(
        (value: Parameters<EncryptedStore["replaceUnverified"]>[0], password: string) =>
          store.replaceUnverified(value, password),
      ),
      // Re-encrypts the same plaintext in the current envelope format, so the
      // vault's content, and with it the grants, does not change.
      upgradeLegacyEnvelope: (password) => store.upgradeLegacyEnvelope(password),
      write: invalidating((value: Parameters<EncryptedStore["write"]>[0], password: string) =>
        store.write(value, password),
      ),
    }),
  };
};
