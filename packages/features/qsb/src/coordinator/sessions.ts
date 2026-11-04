/**
 * The coordinator session tokens the background holds: one per QSB account,
 * bound to the owner address it signed in as, in memory only.
 *
 * A token is a bearer credential for that owner's vaults, so it is never
 * persisted, logged, put in session storage or returned across a message.
 * It is kept for at most an hour from the moment its sign-in began (the
 * coordinator's own `SESSION_SECONDS`), less a minute so it is never used at
 * the edge of its life, on the caller's injected clock; the background drops
 * every one when the wallet locks. The coordinator gives no refresh: an
 * expired or refused token is forgotten and the owner signs in again.
 */

/** How long a coordinator session lives (`SESSION_SECONDS`), in milliseconds. */
export const QSB_SESSION_LIFETIME_MS = 3_600_000;

// Kept short of the server's hour, measured from before the sign-in began.
const SAFETY_MARGIN_MS = 60_000;

/** The per-account token cache. */
export type QsbSessions = {
  /** Drops every token: on lock, and whenever the worker restarts. */
  readonly clear: () => void;
  /** Drops one account's token, after the coordinator refused it. */
  readonly forget: (accountId: string) => void;
  /** Keeps a token for `address`, signed in starting at `signInStartedMs`. */
  readonly remember: (
    accountId: string,
    address: string,
    token: string,
    signInStartedMs: number,
  ) => void;
  /** The account's live token for exactly `address`, or null. */
  readonly token: (accountId: string, address: string) => string | null;
};

type Held = { readonly address: string; readonly expiresAt: number; readonly token: string };

/** Creates an empty cache over the injected clock. */
export const createQsbSessions = (deps: { readonly now: () => number }): QsbSessions => {
  const held = new Map<string, Held>();
  return {
    clear: () => held.clear(),
    forget: (accountId) => {
      held.delete(accountId);
    },
    remember: (accountId, address, token, signInStartedMs) => {
      held.set(accountId, {
        address,
        expiresAt: signInStartedMs + QSB_SESSION_LIFETIME_MS - SAFETY_MARGIN_MS,
        token,
      });
    },
    token: (accountId, address) => {
      const entry = held.get(accountId);
      if (!entry || entry.address !== address || deps.now() >= entry.expiresAt) {
        held.delete(accountId);
        return null;
      }
      return entry.token;
    },
  };
};
