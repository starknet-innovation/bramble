/**
 * Deterministic encodings the bramble-ff publisher signs over: canonical JSON
 * (sorted keys, no whitespace, integers only) and strict unpadded base64url.
 *
 * Mirrors `src/canonical.ts` and `src/base64url.ts` in bramble-ff. For the
 * value space the contract allows, canonical output equals RFC 8785 (JCS).
 * Anything outside that space — floats, non-plain objects, deep nesting —
 * yields null, so a hostile payload can never reach the verifier in an
 * encoding the signer could not have produced. Nothing here throws: these are
 * background-internal checks whose only outcome is "malformed".
 */

const MAX_DEPTH = 16;
const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]*$/;

const encodeAll = (values: readonly unknown[], depth: number): string[] | null => {
  const parts: string[] = [];
  for (const value of values) {
    const part = encode(value, depth);
    if (part === null) {
      return null;
    }
    parts.push(part);
  }
  return parts;
};

const encodeObject = (value: object, depth: number): string | null => {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = encodeAll(
    keys.map((key) => record[key]),
    depth + 1,
  );
  return parts === null
    ? null
    : `{${keys.map((key, index) => `${JSON.stringify(key)}:${parts[index]}`).join(",")}}`;
};

function encode(value: unknown, depth: number): string | null {
  if (depth > MAX_DEPTH) {
    return null;
  }
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value)) {
        return null;
      }
      return Object.is(value, -0) ? "0" : String(value);
    case "object": {
      if (!Array.isArray(value)) {
        return encodeObject(value, depth);
      }
      const parts = encodeAll(value, depth + 1);
      return parts === null ? null : `[${parts.join(",")}]`;
    }
    default:
      return null;
  }
}

/** Canonical UTF-8 bytes of a JSON value, or null outside the contract's value space. */
export const canonicalBytes = (value: unknown): Uint8Array<ArrayBuffer> | null => {
  const text = encode(value, 0);
  return text === null ? null : new TextEncoder().encode(text);
};

const encodeBase64url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * Decodes strict, unpadded base64url, or returns null. Non-canonical
 * spellings (stray trailing bits, padding, foreign characters) are refused, so
 * one value has exactly one accepted encoding.
 */
export const decodeBase64url = (input: string): Uint8Array<ArrayBuffer> | null => {
  if (!BASE64URL_ALPHABET.test(input) || input.length % 4 === 1) {
    return null;
  }
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return encodeBase64url(bytes) === input ? bytes : null;
};
