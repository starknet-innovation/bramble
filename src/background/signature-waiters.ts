/**
 * In-memory registry of held signTypedData responses. A sign request queues an
 * approval and awaits a resolver here; the approval decision settles it,
 * delivering the signature back through the request's own message channel so it
 * is inherently scoped to the origin and tab that asked. Never persisted.
 */
import type { RuntimeResponse } from "./runtime-types";

/**
 * Holds and settles the deferred response for a queued signature request.
 */
export type SignatureWaiters = {
  readonly pending: () => number;
  readonly register: (id: string) => Promise<RuntimeResponse>;
  readonly settle: (id: string, response: RuntimeResponse) => void;
};

/**
 * Creates a signature-waiter registry keyed by approval id.
 */
export const createSignatureWaiters = (): SignatureWaiters => {
  const waiters = new Map<string, (response: RuntimeResponse) => void>();
  return {
    pending() {
      return waiters.size;
    },
    register(id) {
      return new Promise<RuntimeResponse>((resolve) => {
        waiters.set(id, resolve);
      });
    },
    settle(id, response) {
      const resolve = waiters.get(id);
      if (resolve) {
        waiters.delete(id);
        resolve(response);
      }
    },
  };
};
