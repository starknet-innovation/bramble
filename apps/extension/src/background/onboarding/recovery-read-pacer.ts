/** Paced, refusal-resuming chain reads for the recovery discovery walk. */

import { parseRetryAfterMilliseconds } from "@bramble/core/http-json";
import {
  type RpcEndpointBackoff,
  RpcRefusedError,
  RpcTransportError,
  rpcEndpointBackoff,
} from "@bramble/starknet/provider";
import { RECOVERY_SCAN_PACING } from "@bramble/wallet-model/recovery";
import { APPROVAL_KEEPALIVE_MS } from "../approvals/approval-keepalive";

/**
 * The walk's shared read budget. One instance serves every discovery page for
 * the life of the worker, because the picker pulls pages back to back and the
 * gateway counts them all against one address.
 */
export type RecoveryReadPacer = {
  /**
   * Runs one read that makes at most `calls` JSON-RPC calls to `rpcUrls`, once
   * the {@link RECOVERY_SCAN_PACING} budget has room for them. A refusal (the
   * typed one, or every endpoint still cooling down after refusing) pauses
   * every paced read and retries this one, at most `refusalRetries` times. Any
   * other failure, and a refusal past that bound, rejects with the read's own
   * error, so a read that never answered cannot pass for an empty account.
   */
  readonly read: <T>(
    rpcUrls: readonly string[],
    calls: number,
    run: () => Promise<T>,
  ) => Promise<T>;
};

/**
 * Collaborators of {@link createRecoveryReadPacer}; every clock and timer is
 * injected so pacing is deterministic under test. `now` must be the monotonic
 * clock the endpoint cooldowns run on, `wallClock` reads HTTP-date
 * `Retry-After` values, and `keepAlive` touches an extension API so a long
 * walk or pause does not let the worker idle out (absent: nothing is touched).
 */
export type RecoveryReadPacerOptions = {
  readonly backoff?: (rpcUrls: readonly string[]) => RpcEndpointBackoff | null;
  readonly keepAlive?: () => void;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly wallClock?: () => number;
};

const sleepFor = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

/**
 * Builds the discovery read budget. It holds no account data, only call times,
 * and never retries anything but a refusal.
 */
export const createRecoveryReadPacer = ({
  backoff = rpcEndpointBackoff,
  keepAlive,
  now = () => performance.now(),
  sleep = sleepFor,
  wallClock = Date.now,
}: RecoveryReadPacerOptions = {}): RecoveryReadPacer => {
  const { callsPerWindow, maxPauseMs, minPauseMs, refusalRetries, windowMs } = RECOVERY_SCAN_PACING;
  // Start times of the latest `callsPerWindow` calls, oldest first.
  const started: number[] = [];
  let pausedUntil = 0;
  let touchedAt = Number.NEGATIVE_INFINITY;

  // An extension API call at most once per keepalive interval, for as long as
  // reads keep coming or a pause keeps them waiting.
  const touch = (): void => {
    if (keepAlive === undefined || now() - touchedAt < APPROVAL_KEEPALIVE_MS) return;
    touchedAt = now();
    keepAlive();
  };

  // Books one start time, in arrival order, for all of a read's calls: they go
  // out together, so each is logged when the last of them fits. That is at
  // least one window after the call `callsPerWindow` places before it, so no
  // span of `windowMs` ever holds more than `callsPerWindow` calls, and never
  // inside a pause. A read larger than a whole window is booked as one.
  const book = (calls: number): number => {
    const slots = Math.min(Math.max(calls, 0), callsPerWindow);
    const at = Math.max(now(), pausedUntil);
    if (slots === 0) return at;
    const windowStart = started[started.length + slots - 1 - callsPerWindow];
    const fits = Math.max(
      at,
      started[started.length - 1] ?? 0,
      windowStart === undefined ? 0 : windowStart + windowMs,
    );
    for (let slot = 0; slot < slots; slot += 1) started.push(fits);
    started.splice(0, Math.max(0, started.length - callsPerWindow));
    return fits;
  };

  const waitUntil = async (time: number): Promise<void> => {
    for (let remaining = time - now(); remaining > 0; remaining = time - now()) {
      await sleep(Math.min(remaining, APPROVAL_KEEPALIVE_MS));
      touch();
    }
  };

  const acquire = async (calls: number): Promise<void> => {
    touch();
    await waitUntil(book(calls));
    // A refusal that landed while this read waited paused the walk past its
    // booked start. Book again after the pause rather than going out with it.
    while (pausedUntil > now()) {
      await waitUntil(book(calls));
    }
  };

  // How long a failure pauses the walk, or null when it must fail the read. A
  // typed refusal waits out its own Retry-After and the endpoints' cooldown,
  // whichever is later. Any other transport failure counts only when the
  // wallet itself held the call back: every endpoint is cooling down after a
  // refusal, so nothing was sent and nothing was read.
  const pauseAfter = (error: unknown, rpcUrls: readonly string[]): number | null => {
    if (!(error instanceof RpcTransportError)) return null;
    const cooling = backoff(rpcUrls);
    let wait: number | null = null;
    if (error instanceof RpcRefusedError) {
      const requested = parseRetryAfterMilliseconds(error.retryAfter, wallClock());
      wait = Math.max(requested ?? 0, cooling?.retryInMs ?? 0);
    } else if (cooling?.refused) {
      wait = cooling.retryInMs;
    }
    return wait === null ? null : Math.min(Math.max(wait, minPauseMs), maxPauseMs);
  };

  // Pauses the walk for a refusal it may still retry; rethrows anything else.
  const pauseOrThrow = (error: unknown, rpcUrls: readonly string[], attempt: number): void => {
    const pause = attempt < refusalRetries ? pauseAfter(error, rpcUrls) : null;
    if (pause === null) throw error;
    pausedUntil = Math.max(pausedUntil, now() + pause);
  };

  return {
    read: async (rpcUrls, calls, run) => {
      for (let attempt = 0; ; attempt += 1) {
        await acquire(calls);
        try {
          return await run();
        } catch (error) {
          pauseOrThrow(error, rpcUrls, attempt);
        }
      }
    },
  };
};
