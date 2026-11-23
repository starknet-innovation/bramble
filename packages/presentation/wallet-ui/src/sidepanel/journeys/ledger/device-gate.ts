/**
 * One onboarding device read at a time. Cancel closes the open transport
 * before another Connect may open it, and a failure that is this page's own
 * stale handle is retried once before the caller renders an error.
 */

import {
  closeLedgerSessionQuietly,
  type LedgerDeviceSession,
} from "@bramble/ledger-protocol/session";
import { classifyLedgerTransportError } from "@bramble/ledger-protocol/transport-error";

/**
 * Thrown when {@link LedgerDeviceGate.release} wins the race with an open, so
 * the caller does not render that read as a device error.
 */
class LedgerReadAborted extends Error {
  public constructor() {
    super("Ledger read aborted");
    this.name = "LedgerReadAborted";
  }
}

/**
 * True for a read stopped by {@link LedgerDeviceGate.release}. Other errors
 * are device failures and must still be shown.
 */
export const isLedgerReadAborted = (error: unknown): error is LedgerReadAborted =>
  error instanceof LedgerReadAborted;

/**
 * Serial device reads for one onboarding controller. `read` waits out the
 * previous close. `release` closes the active session and stops a retry.
 */
export type LedgerDeviceGate = {
  readonly isBusy: () => boolean;
  readonly read: <T>(
    open: () => Promise<LedgerDeviceSession>,
    use: (session: LedgerDeviceSession) => Promise<T>,
  ) => Promise<T>;
  readonly release: () => Promise<void>;
};

/**
 * Creates a gate that allows one open session. A second `read` waits until the
 * first has closed its transport. An own-stale failure is retried once; a
 * `release` during that read is not.
 */
export const createLedgerDeviceGate = (): LedgerDeviceGate => {
  let active: LedgerDeviceSession | null = null;
  let chain: Promise<void> = Promise.resolve();
  let depth = 0;
  let generation = 0;

  const take = (): LedgerDeviceSession | null => {
    const session = active;
    active = null;
    return session;
  };

  const release = (): Promise<void> => {
    generation += 1;
    const session = take();
    return session ? closeLedgerSessionQuietly(session) : Promise.resolve();
  };

  const attempt = async <T>(
    open: () => Promise<LedgerDeviceSession>,
    use: (session: LedgerDeviceSession) => Promise<T>,
    allowRetry: boolean,
  ): Promise<T> => {
    const token = generation;
    const session = await open();
    if (token !== generation) {
      await closeLedgerSessionQuietly(session);
      throw new LedgerReadAborted();
    }
    active = session;
    try {
      return await use(session);
    } catch (error) {
      const held = take();
      if (held) await closeLedgerSessionQuietly(held);
      if (allowRetry && token === generation && classifyLedgerTransportError(error).ownStale) {
        return attempt(open, use, false);
      }
      throw error;
    }
  };

  const read = async <T>(
    open: () => Promise<LedgerDeviceSession>,
    use: (session: LedgerDeviceSession) => Promise<T>,
  ): Promise<T> => {
    const previous = chain;
    let done = (): void => undefined;
    const next = new Promise<void>((resolve) => {
      done = resolve;
    });
    chain = next;
    await previous.catch(() => undefined);
    depth += 1;
    try {
      return await attempt(open, use, true);
    } finally {
      const leftover = take();
      if (leftover) await closeLedgerSessionQuietly(leftover);
      depth -= 1;
      done();
    }
  };

  return { isBusy: () => depth > 0, read, release };
};
