/**
 * Production timeout wiring for the background Ledger signing queue.
 */

import { notifyApprovalsChanged } from "./approval-notifier";
import {
  createLedgerSignQueue,
  type LedgerSignQueue,
  type LedgerSignQueueTimeout,
} from "./ledger-sign-queue";
import type { UnlockSession } from "./session";

const LEDGER_SIGN_TIMEOUT: LedgerSignQueueTimeout = {
  ms: 300_000,
  schedule: (onElapsed, ms) => {
    const handle = setTimeout(onElapsed, ms);
    return () => clearTimeout(handle);
  },
};

/**
 * Uses an injected queue in tests or creates the session-generation-bound
 * production queue for the service worker.
 */
export const runtimeLedgerSignQueue = (
  provided: LedgerSignQueue | undefined,
  session: UnlockSession,
): LedgerSignQueue =>
  provided ??
  createLedgerSignQueue(notifyApprovalsChanged, LEDGER_SIGN_TIMEOUT, () =>
    session.isUnlocked() ? session.generation() : null,
  );
