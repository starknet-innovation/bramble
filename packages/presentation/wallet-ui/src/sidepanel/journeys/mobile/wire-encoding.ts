/**
 * base64url for the clipboard transport, shared by both directions.
 *
 * UTF-8 aware rather than a bare `btoa`. `btoa` throws on any code point above
 * U+00FF, and the pairing response carries a device name the user chose on their
 * phone — "Mike's iPhone" is fine, an emoji or an accent is not. The existing
 * sign envelope escapes that only because every field in it is hex.
 */

/**
 * Encodes a string as base64url with no padding.
 */
export const toBase64Url = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

/**
 * Decodes base64url, tolerating missing padding. Returns null on anything that
 * is not decodable, so a caller branches rather than catching.
 */
export const fromBase64Url = (value: string): string | null => {
  const normalized = value.trim().replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};
