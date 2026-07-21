/**
 * In-memory queue that bridges a background sign request to the side panel that
 * owns the Ledger transport. The service worker cannot hold a WebHID device, so
 * `request` parks a deferred promise and surfaces the pending intent to the
 * panel, which signs on the device and calls back through `settle` (or `reject`
 * on device/user failure). Never persisted; a worker restart drops in-flight
 * requests, which fail closed as a rejected sign rather than a stuck promise.
 *
 * A request can also be bounded by an OPTIONAL injected timeout: if the panel
 * never opens (or the user walks away), the waiter is removed and the promise
 * rejects with a clean `sign-timeout` rather than parking forever and leaving a
 * dapp-facing approval promise hanging inside a living worker. The timer is
 * injected (not `setTimeout` in this module) so the logic stays pure and the
 * timeout is exercised deterministically in tests; omit it to disable timeouts.
 */
import { WalletError } from "../shared/errors";
import type { DeviceSignature } from "../starknet/ledger-verify";
import type { LedgerSignRequest } from "./ledger-signer";

/**
 * A pending device-sign request the side panel must fulfil, tagged with the
 * queue id used to settle or reject it.
 */
export type PendingLedgerSign = LedgerSignRequest & {
  readonly id: string;
};

/**
 * Coordinates background sign requests with the panel that owns the device.
 * `request` resolves when the panel calls `settle` with the device signature,
 * or rejects when it calls `reject`.
 */
export type LedgerSignQueue = {
  readonly pending: () => readonly PendingLedgerSign[];
  readonly reject: (id: string, reason: string) => boolean;
  readonly request: (request: LedgerSignRequest) => Promise<DeviceSignature>;
  readonly settle: (id: string, signature: DeviceSignature) => boolean;
};

type Waiter = {
  readonly cancelTimeout: () => void;
  readonly intent: PendingLedgerSign;
  readonly reject: (error: WalletError) => void;
  readonly resolve: (signature: DeviceSignature) => void;
};

/**
 * An injected bounded timeout for a parked request. `schedule` starts a timer
 * that invokes `onElapsed` after `ms` and returns a cancel function; the queue
 * cancels it whenever a request settles, rejects, or times out. Injected so this
 * module holds no `setTimeout`, keeping the timeout deterministic in tests.
 */
export type LedgerSignQueueTimeout = {
  readonly ms: number;
  readonly schedule: (onElapsed: () => void, ms: number) => () => void;
};

// The rejection reason a timed-out waiter carries; maps to the `sign-timeout`
// catalog code so the panel/dapp surfaces the graceful copy, not a raw error.
const SIGN_TIMEOUT_REASON = "sign-timeout";

/**
 * Creates a Ledger sign queue. `onRequest` fires whenever a new request is
 * parked, so the background can badge or wake the panel; it defaults to a no-op
 * for tests that drive `settle`/`reject` directly. `timeout`, when provided,
 * bounds each parked request so an unopened panel never hangs the promise.
 */
export const createLedgerSignQueue = (
  onRequest: () => void = () => undefined,
  timeout?: LedgerSignQueueTimeout,
): LedgerSignQueue => {
  const waiters = new Map<string, Waiter>();
  let counter = 0;
  const take = (id: string): Waiter | undefined => {
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
    request(request) {
      counter += 1;
      const id = `ledger-sign-${counter}`;
      return new Promise<DeviceSignature>((resolve, reject) => {
        const cancelTimeout = timeout
          ? timeout.schedule(() => {
              const waiter = take(id);
              waiter?.reject(new WalletError(SIGN_TIMEOUT_REASON));
            }, timeout.ms)
          : () => undefined;
        waiters.set(id, { cancelTimeout, intent: { ...request, id }, reject, resolve });
        onRequest();
      });
    },
    settle(id, signature) {
      const waiter = take(id);
      if (!waiter) {
        return false;
      }
      waiter.resolve(signature);
      return true;
    },
  };
};
