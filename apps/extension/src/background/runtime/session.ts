/**
 * Background-only unlock session. Passphrases stay in extension memory,
 * optionally mirrored to the extension's in-memory session storage so MV3
 * service-worker restarts do not lock the wallet, and expire on a rolling
 * inactivity window like standard wallets.
 *
 * Three invariants make the inactivity window real rather than advisory.
 * First, renewal is a privilege: only {@link UnlockSession.getPassphrase}
 * extends the window, and it is reserved for user-initiated operations, so
 * ambient traffic (dapp polling, panel refresh, background reconciliation)
 * reads through {@link PassiveUnlockSession} and can never hold the wallet
 * unlocked. Second, destruction is time-driven when an
 * {@link UnlockSessionExpiryTimer} is wired: the session is torn down at its
 * own deadline instead of waiting for the next caller to notice, so an idle
 * worker cannot keep the plaintext mirror alive past the TTL. Third, the mirror
 * is written through one serial queue and every erase is proven: a save that
 * was already in flight can never land after the clear meant to erase it, and
 * an erase that cannot be confirmed overwrites the entry with a revocation
 * marker that {@link UnlockSession.restore} refuses — so no later MV3 worker
 * resurrects a session the user revoked.
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
 * Marker written over the mirror when an erase could not be confirmed. It is
 * deliberately not a valid {@link UnlockSessionState}: `restore` refuses it, so
 * a later MV3 worker reading the same session-storage entry stays locked
 * instead of resurrecting a session the user revoked.
 */
export type UnlockSessionRevocation = { readonly revoked: true };

/**
 * Everything the mirror may hold: a live snapshot, or the revocation marker a
 * failed erase leaves behind. Only the first can restore a session.
 */
export type UnlockSessionMirrorEntry = UnlockSessionState | UnlockSessionRevocation;

/**
 * Memory-only mirror used to survive MV3 service-worker restarts. Backed by
 * the extension's session storage area in production: never written to disk,
 * cleared when the browser exits. Writes are issued one at a time by the
 * session, so an implementation only has to be correct for sequential calls.
 */
export type UnlockSessionStore = {
  readonly clear: () => Promise<void>;
  readonly load: () => Promise<unknown>;
  readonly save: (entry: UnlockSessionMirrorEntry) => Promise<void>;
};

/**
 * Wall-clock boundary that destroys an expired session without waiting for a
 * caller. `schedule` replaces any pending wake with one at `atMs` (epoch
 * milliseconds) and must invoke `onElapsed` at or after it; `cancel` drops a
 * pending wake. Injected so this module holds no timer API: production wires
 * it to `chrome.alarms`, which survives MV3 worker termination, while tests
 * drive it by hand. When it is omitted, expiry stays lazy — the session is
 * still refused on every read past its deadline, but the plaintext mirror is
 * only erased once some caller reads it.
 */
export type UnlockSessionExpiryTimer = {
  readonly cancel: () => void;
  readonly schedule: (atMs: number, onElapsed: () => void) => void;
};

/**
 * Non-renewing view of an unlock session. Every read observes the session
 * without extending it, so handlers that run on a cadence the user does not
 * control — dapp-facing message handlers, the side panel's ambient refresh,
 * background reconciliation — must take this type rather than the full
 * {@link UnlockSession}. `generation` returns a monotonic counter that changes
 * whenever the unlocked session boundary changes (a fresh unlock, or any
 * lock/expiry clear): a long-running operation that captured the value when it
 * started can re-check it before committing a side effect and fail closed if
 * the session it was authorized under is no longer current (see
 * {@link captureSessionAuthorization}).
 */
export type PassiveUnlockSession = {
  readonly generation: () => number;
  readonly isUnlocked: () => boolean;
  readonly peekPassphrase: () => string | null;
};

/**
 * Unlock session interface for background-only passphrase access.
 * `getPassphrase` renews the inactivity window and is reserved for
 * user-initiated operations arriving from an extension page; every passive
 * path reads through the {@link PassiveUnlockSession} half instead, so no
 * polling cadence can keep the wallet unlocked forever. `lock` drops the
 * in-memory secret synchronously and `mirrorCleared` reports whether the
 * plaintext session mirror was actually erased — it resolves only once the
 * passphrase is unreadable there, whether it was removed or overwritten with
 * the revocation marker, and rejects when neither could be proven.
 */
export type UnlockSession = PassiveUnlockSession & {
  readonly getPassphrase: () => string | null;
  readonly lock: () => void;
  readonly mirrorCleared: () => Promise<void>;
  readonly restore: () => Promise<void>;
  readonly unlock: (passphrase: string) => void;
};

/**
 * The unlock that authorized an operation: the session generation and the
 * passphrase that were live when it started, plus the one predicate that says
 * whether that unlock is still the current one. This is the single definition
 * of "the session I was authorized under has not moved" — every long-running
 * background operation re-checks it before committing a side effect instead of
 * comparing generations and passphrases by hand.
 */
export type SessionAuthorization = {
  readonly generation: number;
  /**
   * True only while the session is still unlocked under the same generation and
   * the same secret. Never throws and never renews; an authorization taken from
   * a locked session is permanently false, so callers fail closed.
   */
  readonly isCurrent: () => boolean;
  readonly passphrase: string | null;
};

const authorizationFor = (
  session: PassiveUnlockSession,
  generation: number,
  passphrase: string | null,
): SessionAuthorization => ({
  generation,
  isCurrent: () =>
    passphrase !== null &&
    session.generation() === generation &&
    session.peekPassphrase() === passphrase,
  passphrase,
});

/**
 * Captures the session boundary as it is right now, for an operation that is
 * starting here.
 */
export const captureSessionAuthorization = (session: PassiveUnlockSession): SessionAuthorization =>
  authorizationFor(session, session.generation(), session.peekPassphrase());

/**
 * Rebuilds an authorization a caller already holds, for a helper that is handed
 * the generation and passphrase an earlier step captured. A caller holding a
 * stale pair gets a permanently false {@link SessionAuthorization.isCurrent},
 * which is exactly the point: it must not begin work under an unlock that has
 * since been replaced.
 */
export const heldSessionAuthorization = (
  session: PassiveUnlockSession,
  generation: number,
  passphrase: string,
): SessionAuthorization => authorizationFor(session, generation, passphrase);

const isSessionState = (value: unknown): value is UnlockSessionState =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["expiresAt", "passphrase"]) &&
  typeof value["expiresAt"] === "number" &&
  Number.isSafeInteger(value["expiresAt"]) &&
  value["expiresAt"] > 0 &&
  typeof value["passphrase"] === "string" &&
  isVaultPassphrase(value["passphrase"]);

const REVOKED_MIRROR_ENTRY: UnlockSessionRevocation = { revoked: true };

const succeeds = (operation: () => Promise<void>): Promise<boolean> =>
  operation().then(
    () => true,
    () => false,
  );

// Proves the plaintext is gone from the mirror, or throws. A single retry
// absorbs a transient session-storage failure. If the entry still cannot be
// removed, it is overwritten with the revocation marker: that erases the
// passphrase just as effectively and, unlike an in-memory latch, survives the
// MV3 worker that wrote it, so the next worker cannot restore the session.
const eraseMirror = async (mirror: UnlockSessionStore): Promise<void> => {
  if (await succeeds(() => mirror.clear())) {
    return;
  }
  if (await succeeds(() => mirror.clear())) {
    return;
  }
  if (await succeeds(() => mirror.save(REVOKED_MIRROR_ENTRY))) {
    return;
  }
  throw new WalletError("Unlock session mirror not cleared");
};

/**
 * Reaction boundary invoked on every session destruction (explicit lock,
 * expiry, or a failed reconcile). It receives the pending mirror-erase outcome
 * so a failure to erase the plaintext is observable on every path, not only on
 * the explicit lock the user is waiting on. The promise is already handled;
 * a listener that ignores it cannot cause an unhandled rejection.
 */
export type UnlockSessionClearListener = (mirrorCleared: Promise<void>) => void;

/**
 * Everything the unlock session is wired to, by name. Collaborators are keyed
 * rather than positional so a caller can supply the expiry timer without also
 * restating the ttl, the clock, the mirror, and the clear listener — the
 * shape that let production ship without a timer at all while every test that
 * needed one passed five arguments in the right order (MCW-V09-105).
 *
 * Every field is optional and every omission degrades to a safe default: the
 * standard ttl, the system clock, no session-storage mirror (an unlock does not
 * survive an MV3 worker restart), no clear reaction, and lazy expiry (the
 * session is still refused past its deadline, but the plaintext mirror is only
 * erased when some caller next reads it).
 */
export type UnlockSessionOptions = {
  readonly expiryTimer?: UnlockSessionExpiryTimer;
  readonly now?: () => number;
  readonly onClear?: UnlockSessionClearListener;
  readonly store?: UnlockSessionStore;
  readonly ttlMs?: number;
};

/**
 * Creates an expiring background passphrase session. User activity renews the
 * expiry, so the wallet only locks after `ttlMs` of real inactivity, and the
 * optional `expiryTimer` tears the session down at its deadline rather than on
 * the next read. Throws `WalletError` for a ttl that is not a positive safe
 * integer within the eight-hour ceiling, so a misconfigured worker fails closed at
 * construction instead of holding an unbounded unlock.
 */
export const createUnlockSession = ({
  expiryTimer,
  now = () => Date.now(),
  onClear,
  store,
  ttlMs = DEFAULT_TTL_MS,
}: UnlockSessionOptions = {}): UnlockSession => {
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
  // Outcome of the mirror erase issued by the most recent clear. Rejected when
  // the plaintext mirror could not be proven gone.
  let mirrorClear: Promise<void> = Promise.resolve();
  // Tail of the serial mirror-write queue. Every save and every erase runs
  // behind the previous one, so a save that is still in flight when the user
  // locks cannot land after the erase and re-publish the plaintext.
  let mirrorWrites: Promise<void> = Promise.resolve();
  // Latched when a mirror erase failed outright: this worker then refuses to
  // resurrect a session from a mirror it could not prove it had erased. The
  // durable half of that refusal is the revocation marker `eraseMirror` writes.
  let mirrorStale = false;

  const enqueueMirrorWrite = (operation: () => Promise<void>): Promise<void> => {
    const next = mirrorWrites.then(operation, operation);
    mirrorWrites = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const persist = (): void => {
    const mirror = store;
    if (!mirror || passphrase === null) {
      return;
    }
    const entry: UnlockSessionState = { expiresAt, passphrase };
    // The session generation doubles as the mirror's write epoch: a lock,
    // expiry, or re-unlock between queueing this save and running it makes the
    // snapshot stale, and writing it then would republish a revoked secret.
    const epoch = generationCounter;
    persistedAt = expiresAt;
    void enqueueMirrorWrite(async () => {
      if (epoch !== generationCounter) {
        return;
      }
      await mirror.save(entry).catch(() => undefined);
    });
  };

  // Erases the plaintext mirror and records whether that succeeded, behind any
  // write already in flight. Failure is reported through `mirrorCleared` so a
  // lock is never announced as complete while the passphrase is still readable
  // from session storage.
  const clearMirror = (): void => {
    const mirror = store;
    if (!mirror) {
      mirrorClear = Promise.resolve();
      return;
    }
    mirrorClear = enqueueMirrorWrite(() => eraseMirror(mirror)).catch((error: unknown) => {
      mirrorStale = true;
      throw error;
    });
    // The outcome is surfaced through `mirrorCleared()` and to `onClear`; this
    // catch exists only so an unobserved failure never escalates to an
    // unhandled rejection.
    void mirrorClear.catch(() => undefined);
  };

  const clear = (): void => {
    expiresAt = 0;
    passphrase = null;
    persistedAt = 0;
    generationCounter += 1;
    expiryTimer?.cancel();
    clearMirror();
    // Drop any derived-key cache (e.g. the vault AES key) so locking or expiry
    // leaves no usable key material behind in worker memory, and hand over the
    // erase outcome so an expiry that could not clear the mirror is as visible
    // to the background as an explicit lock that could not.
    onClear?.(mirrorClear);
  };

  // Time-driven destruction. The timer wakes at the deadline recorded when it
  // was armed; if the window was renewed since, the session is simply re-armed
  // at the later deadline, so renewal costs no extra scheduling work.
  const onExpiryElapsed = (): void => {
    if (passphrase === null) {
      return;
    }
    if (now() > expiresAt) {
      clear();
      return;
    }
    expiryTimer?.schedule(expiresAt, onExpiryElapsed);
  };

  const armExpiry = (): void => {
    expiryTimer?.schedule(expiresAt, onExpiryElapsed);
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
    mirrorCleared() {
      return mirrorClear;
    },
    peekPassphrase,
    lock() {
      clear();
    },
    async restore() {
      if (!store || passphrase !== null || mirrorStale) {
        return;
      }
      // Read behind any pending mirror write. A restore that raced the erase a
      // lock had just issued would otherwise reload the very secret the user
      // revoked, because the entry is still there until that erase lands.
      await mirrorWrites;
      if (passphrase !== null || mirrorStale) {
        return;
      }
      const stored = await store.load().catch(() => null);
      if (isSessionState(stored) && stored.expiresAt > now()) {
        passphrase = stored.passphrase;
        expiresAt = Math.min(stored.expiresAt, now() + ttlMs);
        persistedAt = stored.expiresAt;
        armExpiry();
        return;
      }
      if (stored === null || stored === undefined) {
        return;
      }
      // The entry is a revocation marker a failed lock left behind, a snapshot
      // that outlived its deadline, or something unrecognized. None may unlock
      // this worker, and none may stay: erase it so no plaintext outlives the
      // inactivity limit in session storage.
      clearMirror();
    },
    unlock(nextPassphrase) {
      if (!isVaultPassphrase(nextPassphrase)) {
        throw new WalletError("Invalid unlock session passphrase");
      }
      // ponytail: background memory session, replace with OS-backed unlock if needed.
      passphrase = nextPassphrase;
      expiresAt = now() + ttlMs;
      generationCounter += 1;
      // A fresh unlock republishes the mirror, so an earlier erase failure no
      // longer describes what is stored there: the latch would otherwise make
      // one transient storage hiccup lock this worker out of every restore.
      mirrorStale = false;
      persist();
      armExpiry();
    },
  };
};
