/**
 * Shared JSON guards used at storage and extension message trust boundaries.
 */
export type JsonPrimitive = boolean | null | number | string;
/**
 * JSON-compatible value accepted by storage boundaries.
 */
export type Json = JsonPrimitive | { readonly [key: string]: Json } | readonly Json[];

/**
 * Checks for non-null object records from untrusted input.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * Checks that a parsed object contains only keys its boundary understands.
 */
export const hasOnlyKnownKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => Reflect.ownKeys(value).every((key) => typeof key === "string" && keys.includes(key));

const isArrayIndexKey = (key: string, length: number): boolean => {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
};

const isJsonArray = (
  value: readonly unknown[],
  ancestors: WeakSet<object>,
): value is readonly Json[] => {
  if (ancestors.has(value)) {
    return false;
  }

  ancestors.add(value);
  try {
    if (
      !Reflect.ownKeys(value).every(
        (key) =>
          key === "length" || (typeof key === "string" && isArrayIndexKey(key, value.length)),
      )
    ) {
      return false;
    }

    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (
        descriptor?.enumerable !== true ||
        !("value" in descriptor) ||
        !isJsonValue(descriptor.value, ancestors)
      ) {
        return false;
      }
    }
    return true;
  } finally {
    ancestors.delete(value);
  }
};

const isJsonObject = (
  value: Record<string, unknown>,
  ancestors: WeakSet<object>,
): value is { readonly [key: string]: Json } => {
  if (ancestors.has(value)) {
    return false;
  }

  ancestors.add(value);
  try {
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string") {
        return false;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        descriptor?.enumerable === true &&
        "value" in descriptor &&
        isJsonValue(descriptor.value, ancestors)
      );
    });
  } finally {
    ancestors.delete(value);
  }
};

const isJsonValue = (value: unknown, ancestors: WeakSet<object>): value is Json => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return isJsonArray(value, ancestors);
  }
  if (!isRecord(value)) {
    return false;
  }
  return isJsonObject(value, ancestors);
};

/**
 * Checks that a runtime value can be serialized as JSON without lossy numeric coercion.
 */
export const isJson = (value: unknown): value is Json => isJsonValue(value, new WeakSet<object>());

/**
 * Checks for arrays containing only strings.
 */
export const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
