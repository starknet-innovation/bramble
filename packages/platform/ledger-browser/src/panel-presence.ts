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
    await held;
    void request.catch(() => undefined);
    return release;
  } catch {
    return () => undefined;
  }
};

/**
 * Resolves true once a panel lock that was held or pending is released, which
 * means the panel is gone. Resolves false when no such lock appears, so a tab
 * opened without a panel is not closed on a timer of its own.
 */
export const watchLedgerPanelLock = async (
  locks: LedgerLockManager,
  sessionId: string,
  pause: () => Promise<void>,
  attempts = 20,
): Promise<boolean> => {
  if (!locks.query) return false;
  const name = ledgerPanelLockName(sessionId);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await locks.query();
    const seen = [...(state.held ?? []), ...(state.pending ?? [])].some(
      (lock) => lock.name === name,
    );
    if (seen) {
      await locks.request(name, async () => undefined);
      return true;
    }
    await pause();
  }
  return false;
};
