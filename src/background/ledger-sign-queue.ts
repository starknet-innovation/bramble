/**
 * In-memory queue that bridges a background sign request to the side panel that
 * owns the Ledger transport. The service worker cannot hold a WebHID device, so
 * `request` parks a deferred promise and surfaces the pending intent to the
 * panel, which signs on the device and calls back through `settle` (or `reject`
 * on device/user failure). Never persisted; a worker restart drops in-flight
 * requests, which fail closed as a rejected sign rather than a stuck promise.
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
  readonly intent: PendingLedgerSign;
  readonly reject: (error: WalletError) => void;
  readonly resolve: (signature: DeviceSignature) => void;
};

/**
 * Creates a Ledger sign queue. `onRequest` fires whenever a new request is
 * parked, so the background can badge or wake the panel; it defaults to a no-op
 * for tests that drive `settle`/`reject` directly.
 */
export const createLedgerSignQueue = (onRequest: () => void = () => undefined): LedgerSignQueue => {
  const waiters = new Map<string, Waiter>();
  let counter = 0;
  return {
    pending() {
      return [...waiters.values()].map((waiter) => waiter.intent);
    },
    reject(id, reason) {
      const waiter = waiters.get(id);
      if (!waiter) {
        return false;
      }
      waiters.delete(id);
      waiter.reject(new WalletError(reason));
      return true;
    },
    request(request) {
      counter += 1;
      const id = `ledger-sign-${counter}`;
      return new Promise<DeviceSignature>((resolve, reject) => {
        waiters.set(id, { intent: { ...request, id }, reject, resolve });
        onRequest();
      });
    },
    settle(id, signature) {
      const waiter = waiters.get(id);
      if (!waiter) {
        return false;
      }
      waiters.delete(id);
      waiter.resolve(signature);
      return true;
    },
  };
};
