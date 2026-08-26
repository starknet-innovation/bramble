/**
 * In-memory queue that bridges a background sign request to the side panel that
 * owns an external signing device. The service worker cannot hold a browser
 * device or reach a phone, so `request` parks a deferred promise and surfaces
 * the pending intent to the panel, which drives the device and calls back
 * through `settle` (or `reject` on device/user failure). Never persisted; a
 * worker restart drops in-flight requests, which fail closed as a rejected sign
 * rather than a stuck promise.
 *
 * A request can also be bounded by an OPTIONAL injected timeout: if the panel
 * never opens (or the user walks away), the waiter is removed and the promise
 * rejects with a clean `sign-timeout` rather than parking forever and leaving a
 * dapp-facing approval promise hanging inside a living worker. The timer is
 * injected (not `setTimeout` in this module) so the logic stays pure and the
 * timeout is exercised deterministically in tests; omit it to disable timeouts.
 *
 * Device-agnostic on purpose. A Ledger and a paired phone differ in what they
 * are handed, what they hand back, and how long a human takes to answer — but
 * not in the parking, the session boundary, or the fail-closed rules, and those
 * are the parts worth having exactly one copy of. Each device binds its own
 * instance with its own request/response types and its own timeout.
 */
import { WalletError } from "@mc-wallet/core/errors";

/**
 * A parked device-sign request the side panel must fulfil, tagged with the queue
 * id used to settle or reject it.
 */
export type PendingDeviceSign<TRequest> = TRequest & {
  readonly id: string;
};

/**
 * Coordinates background sign requests with the panel that owns the device.
 * `request` resolves when the panel calls `settle` with the device response, or
 * rejects when it calls `reject`.
 */
export type DeviceSignQueue<TRequest, TResponse> = {
  readonly pending: () => readonly PendingDeviceSign<TRequest>[];
  readonly reject: (id: string, reason: string) => boolean;
  /**
   * Rejects every currently-parked request with `reason` and returns how many
   * were rejected. Used on an explicit `wallet.lock` so a device sign parked
   * for the side panel can never be completed and broadcast after the lock —
   * each rejection settles the held dapp waiter with `reason` and clears its
   * approval through the executor's normal error path. Fails closed.
   */
  readonly rejectAll: (reason: string) => number;
  readonly request: (request: TRequest) => Promise<TResponse>;
  readonly settle: (id: string, response: TResponse) => boolean;
};

type Waiter<TRequest, TResponse> = {
  readonly cancelTimeout: () => void;
  // The unlock-session generation captured when this request was parked. The
  // device round-trip can outlive the session that authorized it (the user
  // locks, or the session expires, while the device is confirming); settle
  // compares this against the live generation and fails closed on a change so a
  // response is never verified/broadcast under a session that no longer holds.
  readonly generation: number;
  readonly intent: PendingDeviceSign<TRequest>;
  readonly reject: (error: WalletError) => void;
  readonly resolve: (response: TResponse) => void;
};

/**
 * An injected bounded timeout for a parked request. `schedule` starts a timer
 * that invokes `onElapsed` after `ms` and returns a cancel function; the queue
 * cancels it whenever a request settles, rejects, or times out. Injected so this
 * module holds no `setTimeout`, keeping the timeout deterministic in tests.
 */
export type DeviceSignQueueTimeout = {
  readonly ms: number;
  readonly schedule: (onElapsed: () => void, ms: number) => () => void;
};

// The rejection reason a timed-out waiter carries; maps to the `sign-timeout`
// catalog code so the panel/dapp surfaces the graceful copy, not a raw error.
const SIGN_TIMEOUT_REASON = "sign-timeout";

/**
 * Creates a device sign queue. `idPrefix` names the device kind in queue ids, so
 * a settle intended for one device can never address another's parked request.
 * `onRequest` fires whenever a new request is parked, so the background can
 * badge or wake the panel; it defaults to a no-op for tests that drive
 * `settle`/`reject` directly. `timeout`, when provided, bounds each parked
 * request so an unopened panel never hangs the promise. `currentGeneration`
 * reads the live unlock-session generation (see {@link UnlockSession.generation});
 * the queue captures it when a request is parked and re-checks it at settle so a
 * device response that returns after a lock/expiry is rejected rather than
 * broadcast. It returns `null` when the session is no longer unlocked, which
 * also forces lazy TTL expiry before a request is parked or settled. It defaults
 * to a constant, so a queue wired without a session simply never observes a
 * generation change.
 */
export const createDeviceSignQueue = <TRequest, TResponse>(
  idPrefix: string,
  onRequest: () => void = () => undefined,
  timeout?: DeviceSignQueueTimeout,
  currentGeneration: () => number | null = () => 0,
): DeviceSignQueue<TRequest, TResponse> => {
  const waiters = new Map<string, Waiter<TRequest, TResponse>>();
  let counter = 0;
  const take = (id: string): Waiter<TRequest, TResponse> | undefined => {
    const waiter = waiters.get(id);
    if (!waiter) {
      return undefined;
    }
    waiters.delete(id);
    waiter.cancelTimeout();
    return waiter;
  };
  return {
    pending() {
      return [...waiters.values()].map((waiter) => waiter.intent);
    },
    reject(id, reason) {
      const waiter = take(id);
      if (!waiter) {
        return false;
      }
      waiter.reject(new WalletError(reason));
      return true;
    },
    rejectAll(reason) {
      // Snapshot ids first: `take` mutates the map as each waiter is removed.
      const ids = [...waiters.keys()];
      for (const id of ids) {
        take(id)?.reject(new WalletError(reason));
      }
      return ids.length;
    },
    request(request) {
      counter += 1;
      const id = `${idPrefix}-${counter}`;
      const generation = currentGeneration();
      if (generation === null) {
        return Promise.reject(new WalletError("wallet locked"));
      }
      return new Promise<TResponse>((resolve, reject) => {
        const cancelTimeout = timeout
          ? timeout.schedule(() => {
              const waiter = take(id);
              waiter?.reject(new WalletError(SIGN_TIMEOUT_REASON));
            }, timeout.ms)
          : () => undefined;
        waiters.set(id, { cancelTimeout, generation, intent: { ...request, id }, reject, resolve });
        onRequest();
      });
    },
    settle(id, response) {
      const waiter = take(id);
      if (!waiter) {
        return false;
      }
      // Fail closed on a session-boundary change: if the wallet locked or the
      // session expired (and re-unlocked) while the device was signing, the
      // response is no longer authorized under the current session — reject the
      // parked promise instead of resolving it, so nothing is verified or
      // broadcast across the lock.
      const generation = currentGeneration();
      if (generation === null || generation !== waiter.generation) {
        waiter.reject(new WalletError("wallet locked"));
        return false;
      }
      waiter.resolve(response);
      return true;
    },
  };
};
