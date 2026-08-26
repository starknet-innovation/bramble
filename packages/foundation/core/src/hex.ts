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

/**
 * Parses a lowercase `0x`-prefixed hex byte string into its bytes, or null when
 * the input is not one: a missing prefix, an odd digit count, uppercase, or any
 * non-hex character. The inverse of {@link bytesToHex} and total in the same
 * way — no input can throw, so a caller validating an untrusted encoding gets a
 * decision rather than an exception. It is a decoding, not a hash: the bytes
 * carry exactly the meaning the digits did.
 */
export const hexToBytes = (value: string): Uint8Array | null => {
  if (!/^0x(?:[0-9a-f]{2})*$/.test(value)) {
    return null;
  }
  const digits = value.slice(2);
  const bytes = new Uint8Array(digits.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};
