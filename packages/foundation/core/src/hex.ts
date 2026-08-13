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
