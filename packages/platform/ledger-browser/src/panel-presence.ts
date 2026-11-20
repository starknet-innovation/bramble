/**
 * Same-origin Web Lock tying a hardware tab's device claim to the side panel
 * that opened it. The panel holds the lock for the session. The grant tab
 * waits on the same name. The browser drops the lock when the panel's document
 * is destroyed, including a crash, so the tab does not keep the Ledger until
 * the idle timer. A runtime without Web Locks is a no-op; the idle timer
 * remains the backstop.
 */

/**
 * Lock name for one grant session. The session id is the unguessable channel
 * capability, already validated before either side uses it.
 */
export const ledgerPanelLockName = (sessionId: string): string =>
  `bramble-ledger-panel:${sessionId}`;

/**
 * The slice of the Web Locks API this session uses. Injectable so tests do not
 * need a browser.
 */
export type LedgerLockManager = {
  readonly query?: () => Promise<{
    readonly held?: readonly { readonly name?: string }[];
    readonly pending?: readonly { readonly name?: string }[];
  }>;
  readonly request: (name: string, callback: () => Promise<void>) => Promise<unknown>;
};

/**
 * The page's `navigator.locks`, or null when this runtime has no Web Locks.
 */
export const browserLedgerLocks = (): LedgerLockManager | null => {
  if (typeof navigator === "undefined" || !navigator.locks) return null;
  const locks = navigator.locks;
  return {
    query: () => locks.query(),
    request: (name, callback) => locks.request(name, callback),
  };
};

/**
 * Holds the panel lock until the returned function runs. A missing manager, or
 * a lock request that fails, resolves to a no-op so the grant tab still opens.
 */
export const holdLedgerPanelLock = async (
  locks: LedgerLockManager | null,
  sessionId: string,
): Promise<() => void> => {
  if (!locks) return () => undefined;
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    let markHeld = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    const request = locks.request(ledgerPanelLockName(sessionId), async () => {
      markHeld();
      await released;
    });
    // A request that settles before its callback ran (rejected, or a document
    // that is not fully active) never marks the lock held. Race it so the
    // caller gets the no-op instead of waiting forever.
    let granted = false;
    await Promise.race([
      held.then(() => {
        granted = true;
      }),
      request.then(
        () => undefined,
        () => undefined,
      ),
    ]);
    if (!granted) return () => undefined;
    void request.catch(() => undefined);
    return release;
  } catch {
    return () => undefined;
  }
};

/**
 * True when some document holds or waits on this session's panel lock, which
 * means the side panel that opened the grant tab is still alive. A runtime
 * whose lock manager cannot be queried answers true, so nothing is closed on
 * a guess.
 */
export const isLedgerPanelLockLive = async (
  locks: LedgerLockManager,
  sessionId: string,
): Promise<boolean> => {
  if (!locks.query) return true;
  const name = ledgerPanelLockName(sessionId);
  const state = await locks.query();
  return [...(state.held ?? []), ...(state.pending ?? [])].some((lock) => lock.name === name);
};

/**
 * Resolves true once the panel lock is released, which means the panel is
 * gone. The panel takes the lock before it creates the grant tab, so one
 * query is enough: when no lock is there (no Web Locks in the panel, or its
 * request failed) this resolves false and the idle timer stays the backstop.
 */
export const watchLedgerPanelLock = async (
  locks: LedgerLockManager,
  sessionId: string,
): Promise<boolean> => {
  if (!locks.query) return false;
  if (!(await isLedgerPanelLockLive(locks, sessionId))) return false;
  await locks.request(ledgerPanelLockName(sessionId), async () => undefined);
  return true;
};
