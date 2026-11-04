/**
 * The per-account QSB lock: one promise chain per QSB account id, in worker
 * memory only, so one account's vault flows (list, create, quote, deposit,
 * resend) run end to end one at a time, while the vault service's own queue
 * is taken only for each flow's short local steps.
 *
 * It is what keeps two flows of one account from interleaving across their
 * network calls: two creates allocate consecutive indices, two deposits into
 * one vault never both reach `fund/submit`. Every durable step still
 * re-validates in its own vault slot, so the lock orders the flows and the
 * slots keep each write correct. A flow that fails releases the lock; a
 * worker restart starts with none held.
 */

/** Runs tasks one at a time per account id. */
export type QsbAccountLocks = {
  readonly run: <T>(accountId: string, task: () => Promise<T>) => Promise<T>;
};

/** Creates an empty set of locks. */
export const createQsbAccountLocks = (): QsbAccountLocks => {
  const tails = new Map<string, Promise<void>>();
  return {
    run(accountId, task) {
      const previous = tails.get(accountId) ?? Promise.resolve();
      const next = previous.then(task);
      const tail = next.then(
        () => undefined,
        () => undefined,
      );
      tails.set(accountId, tail);
      void tail.then(() => {
        if (tails.get(accountId) === tail) tails.delete(accountId);
      });
      return next;
    },
  };
};
