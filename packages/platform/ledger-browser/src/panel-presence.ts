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
 * Web Lock mode. The panel holds the session lock exclusive; the grant tab
 * waits shared, so its wait is never read as a live panel.
 */
export type LedgerLockMode = "exclusive" | "shared";

/**
 * What a lock query returns. Entries are untrusted shape; a missing mode is
 * read as exclusive, the Web Locks default.
 */
export type LedgerLockSnapshot = {
  readonly held?: readonly { readonly mode?: LedgerLockMode; readonly name?: string }[];
  readonly pending?: readonly { readonly mode?: LedgerLockMode; readonly name?: string }[];
};

/**
 * The slice of the Web Locks API this session uses. Injectable so tests do not
 * need a browser.
 */
export type LedgerLockManager = {
  readonly query?: () => Promise<LedgerLockSnapshot>;
  readonly request: (
    name: string,
    callback: () => Promise<void>,
    mode?: LedgerLockMode,
  ) => Promise<unknown>;
};

/**
 * The page's `navigator.locks`, or null when this runtime has no Web Locks.
 */
export const browserLedgerLocks = (): LedgerLockManager | null => {
  if (typeof navigator === "undefined" || !navigator.locks) return null;
  const locks = navigator.locks;
  return {
    query: () => locks.query(),
    request: (name, callback, mode = "exclusive") => locks.request(name, { mode }, callback),
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
 * True when a side panel still holds this session's lock. The panel takes it
 * exclusive. The grant tab only waits with a shared request, and that wait
 * stays pending or briefly held after the panel is gone, so neither a pending
 * request nor a shared hold counts. A manager that cannot be queried answers
 * true, so nothing is closed on a guess.
 */
export const isLedgerPanelLockLive = async (
  locks: LedgerLockManager,
  sessionId: string,
): Promise<boolean> => {
  if (!locks.query) return true;
  const name = ledgerPanelLockName(sessionId);
  const state = await locks.query();
  return (state.held ?? []).some((lock) => lock.name === name && lock.mode !== "shared");
};

/**
 * True when the grant tab's shared wait shows the panel held this lock and
 * has let it go. No lock at all is not evidence: {@link holdLedgerPanelLock}
 * can fail open and the panel can still be using the tab. A manager that
 * cannot be queried answers false, so nothing is closed on a guess.
 */
export const isLedgerGrantTabOrphaned = async (
  locks: LedgerLockManager,
  sessionId: string,
): Promise<boolean> => {
  if (!locks.query) return false;
  const name = ledgerPanelLockName(sessionId);
  const state = await locks.query();
  const held = (state.held ?? []).filter((lock) => lock.name === name);
  if (held.some((lock) => lock.mode !== "shared")) return false;
  const pending = (state.pending ?? []).filter((lock) => lock.name === name);
  return (
    held.some((lock) => lock.mode === "shared") || pending.some((lock) => lock.mode === "shared")
  );
};

/**
 * Waits until the panel lock is released, then runs `onGone` while this tab
 * still holds the shared lock. A reconnect can see that hold and tell the tab
 * is ours until the device is free. The panel takes the lock before it creates
 * the grant tab, so one query is enough: when no lock is there this returns
 * false and does not call `onGone`, and the idle timer stays the backstop.
 */
export const watchLedgerPanelLock = async (
  locks: LedgerLockManager,
  sessionId: string,
  onGone: () => Promise<void>,
): Promise<boolean> => {
  if (!locks.query) return false;
  if (!(await isLedgerPanelLockLive(locks, sessionId))) return false;
  // Shared, so this wait is not mistaken for the panel's exclusive hold.
  await locks.request(ledgerPanelLockName(sessionId), () => onGone(), "shared");
  return true;
};
