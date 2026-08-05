/**
 * Pure decoder for a self-contained `data:text/html` NFT animation URI, kept
 * DOM-free so it can be unit-tested in isolation. It accepts only
 * `data:text/html` (base64 or raw/percent-encoded utf8) within a fixed size cap
 * and returns the decoded HTML, or null when the URI is malformed, the wrong
 * media type, or oversized. It performs no rendering and confers no trust: the
 * returned HTML is only ever loaded into the render page's nested sandbox,
 * whose isolated security principals and egress-blocking CSP contain it.
 */

// Matches MAX_IMAGE_DATA_URI_LENGTH / MAX_DATA_URI_BYTES: the animation can never
// be larger than the metadata document that carried it.
const MAX_ANIMATION_BYTES = 32_768;

/**
 * Decodes a validated `data:text/html` animation URI to its HTML string, or null
 * when it is not a usable self-contained HTML data URI. Fails closed on any
 * malformed input rather than throwing.
 */
export const decodeHtmlDataUri = (uri: string): string | null => {
  if (typeof uri !== "string" || !uri.startsWith("data:") || uri.length > MAX_ANIMATION_BYTES) {
    return null;
  }
  const comma = uri.indexOf(",");
  if (comma < 0) {
    return null;
  }
  const params = uri.slice("data:".length, comma).toLowerCase().split(";");
  const payload = uri.slice(comma + 1);
  if (params[0] !== "text/html" || payload.length === 0) {
    return null;
  }
  try {
    const html = params.includes("base64")
      ? new TextDecoder().decode(
          Uint8Array.from(atob(payload), (character) => character.charCodeAt(0)),
        )
      : decodeURIComponent(payload);
    return new TextEncoder().encode(html).length <= MAX_ANIMATION_BYTES ? html : null;
  } catch {
    return null;
  }
};
