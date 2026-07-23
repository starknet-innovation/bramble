/**
 * Serializes every mutating method of a store across its full async
 * read-modify-write transaction. Read-only methods remain concurrent. A failed
 * mutation rejects its caller but never poisons the queue for later work.
 */
export const serializeStoreMutations = <T extends object>(
  implementation: T,
  readOnlyMethods: readonly (keyof T)[],
): T => {
  let tail: Promise<void> = Promise.resolve();
  const readOnly = new Set<PropertyKey>(readOnlyMethods);
  const wrapped = new Map<PropertyKey, unknown>();

  return new Proxy(implementation, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function" || readOnly.has(property)) {
        return value;
      }
      const existing = wrapped.get(property);
      if (existing) {
        return existing;
      }
      const serialized = (...args: readonly unknown[]): Promise<unknown> => {
        const run = (): Promise<unknown> => Promise.resolve(Reflect.apply(value, target, args));
        const result = tail.then(run, run);
        tail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      };
      wrapped.set(property, serialized);
      return serialized;
    },
  });
};
