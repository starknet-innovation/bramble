/** Bounded in-flight request ids for the page-to-content bridge. */
import { canQueueProviderRequest } from "@bramble/wallet-protocol/bridge";

/**
 * Content-script request reservation. Acquire returns false at capacity or for
 * a duplicate id; release is idempotent and holds no request payload.
 */
export type ProviderRequestAdmission = {
  readonly acquire: (id: string) => boolean;
  readonly release: (id: string) => void;
};

/**
 * Creates one admission gate per content-script instance and page origin. It
 * fails closed at the shared provider cap and retains request ids only.
 */
export const createProviderRequestAdmission = (): ProviderRequestAdmission => {
  const pending = new Set<string>();
  return {
    acquire(id) {
      if (pending.has(id) || !canQueueProviderRequest(pending.size)) return false;
      pending.add(id);
      return true;
    },
    release: (id) => pending.delete(id),
  };
};
