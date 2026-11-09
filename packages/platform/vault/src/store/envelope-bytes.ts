/**
 * Byte and text encodings shared by the encrypted envelope and the freshness
 * records that vouch for it.
 *
 * A leaf module with no dependencies of its own, so the store and the freshness
 * authority can both use these without importing each other.
 */

/** Encodes bytes as base64, the form envelopes are stored in. */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

/** Decodes base64 back to bytes. Throws on input that is not base64. */
export const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

/**
 * Whether a string is base64 of exactly `byteLength` bytes, or of any non-zero
 * length when no length is given. Used to validate values read back from
 * storage, which is untrusted: a field of the wrong size is rejected before it
 * reaches a cipher or a comparison.
 */
export const hasBase64Bytes = (value: string, byteLength?: number): boolean => {
  try {
    const bytes = base64ToBytes(value);
    return byteLength === undefined ? bytes.byteLength > 0 : bytes.byteLength === byteLength;
  } catch {
    return false;
  }
};

/** Encodes bytes as lowercase hex, the form lineage identifiers are stored in. */
export const bytesToHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
