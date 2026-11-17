/**
 * Deterministic encodings the bramble-ff publisher signs over: canonical JSON
 * (sorted keys, no whitespace, integers only) and strict unpadded base64url.
 *
 * Mirrors `src/canonical.ts` and `src/base64url.ts` in bramble-ff. For the
 * value space the contract allows, canonical output equals RFC 8785 (JCS).
 * Anything outside that space — floats, non-plain objects, deep nesting —
 * throws, so a hostile payload can never reach the verifier in an encoding the
 * signer could not have produced.
 */

const MAX_DEPTH = 16;
const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]*$/;

const encode = (value: unknown, depth: number): string => {
  if (depth > MAX_DEPTH) {
    throw new TypeError("canonical JSON nesting too deep");
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("canonical JSON allows only safe integers");
    }
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => encode(item, depth + 1)).join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("canonical JSON allows only plain objects");
    }
    const record = value as Record<string, unknown>;
    const parts = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encode(record[key], depth + 1)}`);
    return `{${parts.join(",")}}`;
  }
  throw new TypeError("canonical JSON value type is unsupported");
};

/** Canonical UTF-8 bytes of a JSON value; throws outside the contract's value space. */
export const canonicalBytes = (value: unknown): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(encode(value, 0));

const encodeBase64url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * Decodes strict, unpadded base64url. Non-canonical spellings (stray trailing
 * bits, padding, foreign characters) throw, so one value has exactly one
 * accepted encoding.
 */
export const decodeBase64url = (input: string): Uint8Array<ArrayBuffer> => {
  if (!BASE64URL_ALPHABET.test(input) || input.length % 4 === 1) {
    throw new TypeError("invalid base64url");
  }
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (encodeBase64url(bytes) !== input) {
    throw new TypeError("non-canonical base64url");
  }
  return bytes;
};
