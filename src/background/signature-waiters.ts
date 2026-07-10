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
 * Creates a signature-waiter registry keyed by approval id. Deduped requests
 * (e.g. two tabs of one origin connecting) register against the same approval
 * id, so each id holds a list of resolvers and settling resolves them all —
 * an unconditional overwrite here would orphan the earlier request forever.
 */
export const createSignatureWaiters = (): SignatureWaiters => {
  const waiters = new Map<string, ((response: RuntimeResponse) => void)[]>();
  return {
    pending() {
      return waiters.size;
    },
    register(id) {
      return new Promise<RuntimeResponse>((resolve) => {
        waiters.set(id, [...(waiters.get(id) ?? []), resolve]);
      });
    },
    settle(id, response) {
      const resolvers = waiters.get(id);
      if (resolvers) {
        waiters.delete(id);
        for (const resolve of resolvers) {
          resolve(response);
        }
      }
    },
  };
};
