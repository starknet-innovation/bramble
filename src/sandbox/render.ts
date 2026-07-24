/**
 * Sandbox render-page entrypoint. This module runs inside the manifest-declared
 * sandbox page (`sandbox/render.html`), which Chrome loads in a unique opaque
 * origin with no `chrome.*` access and under an egress-blocking CSP. It reads the
 * collectible's `data:text/html` animation from its own URL hash, decodes it, and
 * writes it into this document so the untrusted inline script runs confined here
 * — never in the privileged side panel, and with no path to the vault or the
 * network. Anything malformed fails closed to a short message.
 */
import { decodeHtmlDataUri } from "./render-payload";

// The untrusted URI arrives via the iframe URL hash (not postMessage), so the
// side panel needs no window-message listener and nothing here can be reached by
// the isolated animation.
const readHash = (): string => {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return "";
  }
};

const html = decodeHtmlDataUri(readHash());
if (html === null) {
  document.body.textContent = "This collectible's animation could not be rendered.";
} else {
  // document.write into this same document keeps the sandbox page's opaque origin
  // and egress-blocking CSP; the written inline canvas script executes under them.
  document.open();
  document.write(html);
  document.close();
}
