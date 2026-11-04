/**
 * How the Krusty KMS adapter reads the WASM module and the objects its calls
 * return, shared by ./adapter and ./bitcoin so neither keeps a private copy.
 *
 * Trust boundary: the module and every result are untrusted until checked. A
 * field is read only as an own data property, or through the getter of one of
 * Krusty's own result classes (named in {@link KRUSTY_RESULT_CLASSES}); a
 * getter anywhere else never runs. Every failure throws a `WalletError` naming
 * the field, never its value.
 */
import { WalletError } from "@bramble/core/errors";
import { isOwnDataProperty } from "@bramble/core/json";

/** A WASM export once it is known to be a function. */
export type Callable = (...args: unknown[]) => unknown;

/**
 * Krusty's result classes, by constructor name: the only prototypes whose
 * getters the adapter will run, and whose `free` it will call.
 */
const KRUSTY_RESULT_CLASSES = new Set([
  "WasmBitcoinP2wpkhKeypair",
  "WasmKeypair",
  "WasmNostrPublicKey",
  "WasmQsbCommitments",
  "WasmStarkSignature",
  "WasmStarkXOnlyKeypair",
]);

/** The value as a record, or a throw when the module did not load as an object. */
export const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    throw new WalletError("Krusty KMS module did not load as an object");
  }
  return value as Record<string, unknown>;
};

/**
 * Reads a field only when it is an own enumerable data property, through the
 * shared boundary predicate: a getter on the WASM module object must never run
 * during validation, and must never answer differently on a second read.
 */
export const ownValue = (record: Record<string, unknown>, field: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  return isOwnDataProperty(descriptor) ? descriptor.value : undefined;
};

// The own prototype property `field` of a Krusty result object, or undefined
// when the object is not an instance of one of Krusty's result classes.
const resultClassMember = (
  record: Record<string, unknown>,
  field: string,
): PropertyDescriptor | undefined => {
  const prototype = Object.getPrototypeOf(record);
  const prototypeConstructor = prototype
    ? Object.getOwnPropertyDescriptor(prototype, "constructor")?.value
    : null;
  return typeof prototypeConstructor === "function" &&
    KRUSTY_RESULT_CLASSES.has(prototypeConstructor.name)
    ? Object.getOwnPropertyDescriptor(prototype, field)
    : undefined;
};

/**
 * One field of a Krusty result: an own data property, else the getter of a
 * Krusty result class. Undefined for anything else.
 */
export const krustyResultValue = (record: Record<string, unknown>, field: string): unknown => {
  const value = ownValue(record, field);
  if (value !== undefined) {
    return value;
  }
  const descriptor = resultClassMember(record, field);
  return typeof descriptor?.get === "function" ? descriptor.get.call(record) : undefined;
};

/**
 * Frees a Krusty result object once it has been read, which zeroizes what
 * Krusty keeps of it in WASM memory (a private key, for a keypair). A plain
 * object, or one whose class is not Krusty's, has nothing to free. Never
 * throws: a failed free must not hide the result it followed.
 */
export const freeKrustyResult = (value: unknown): void => {
  if (typeof value !== "object" || value === null) {
    return;
  }
  const free = resultClassMember(value as Record<string, unknown>, "free")?.value;
  if (typeof free === "function") {
    try {
      free.call(value);
    } catch {
      // The value was already read; nothing more is owed here.
    }
  }
};

/** One required export of the module, or a throw naming the missing one. */
export const requireFunction = (module: Record<string, unknown>, name: string): Callable => {
  const value = ownValue(module, name);
  if (typeof value !== "function") {
    throw new WalletError(`Krusty KMS export missing: ${name}`);
  }
  return value as Callable;
};

/** One string field of a Krusty result, or a throw naming it. */
export const requireStringField = (value: unknown, field: string): string => {
  const record = asRecord(value);
  const fieldValue = krustyResultValue(record, field);
  if (typeof fieldValue !== "string") {
    throw new WalletError(`Krusty KMS result missing string field: ${field}`);
  }
  return fieldValue;
};
