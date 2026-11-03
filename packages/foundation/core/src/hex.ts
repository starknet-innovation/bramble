/**
 * Byte-to-hex rendering shared by the modules that turn a digest into a stable
 * identifier. Pure and leaf-level: no clock, randomness, storage, or network.
 * Three byte-identical copies of this fold had already drifted across the
 * background and side-panel trees, so it lives here once.
 */

/**
 * Renders bytes as lowercase hex, two characters per byte and no separator.
 * Total for every `Uint8Array`; an empty input renders as the empty string, and
 * no input can throw. The result is printable ASCII, so a caller may embed it
 * in a digest preimage or a Cairo short string without further escaping. It is
 * an encoding, not a hash: callers needing collision resistance must supply
 * bytes that already have it.
 */
export const bytesToHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const LOWERCASE_HEX_BYTES_PATTERN = /^(?:[0-9a-f]{2})*$/;

/**
 * Checks for unprefixed lowercase hex that encodes a whole number of bytes
 * within `[minBytes, maxBytes]`: the spelling Bitcoin-facing records use for
 * hashes, scripts, and serialized transactions. The length is checked before
 * the pattern, so an oversized untrusted string costs no regex work. Uppercase,
 * a `0x` prefix, an odd digit count, or a non-string is rejected, never
 * coerced, so one byte string has exactly one accepted spelling.
 */
export const isLowercaseHexBytes = (
  value: unknown,
  minBytes: number,
  maxBytes: number,
): value is string =>
  typeof value === "string" &&
  value.length >= minBytes * 2 &&
  value.length <= maxBytes * 2 &&
  LOWERCASE_HEX_BYTES_PATTERN.test(value);

/**
 * Decodes unprefixed lowercase hex into bytes, the inverse of
 * {@link bytesToHex}. Returns null for anything {@link isLowercaseHexBytes}
 * would refuse at an unbounded length, so a caller can never act on a partial
 * or reinterpreted decode. Bounds belong to the caller's own grammar.
 */
export const hexToBytes = (value: string): Uint8Array | null => {
  if (!isLowercaseHexBytes(value, 0, value.length)) {
    return null;
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};
