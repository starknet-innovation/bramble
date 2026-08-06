/**
 * Sandbox render-page entrypoint. This module runs inside the manifest-declared
 * sandbox page (`sandbox/render.html`), which Chrome runs in a separate security
 * principal with no privileged extension APIs or parent-DOM access and under an
 * egress-blocking CSP. It reads the collectible's `data:text/html` animation from
 * its own URL hash, decodes it, and loads it into a second sandboxed frame so the
 * untrusted inline script runs behind two browser principals — never in the
 * privileged side panel, and with no path to the vault or the network. Anything
 * malformed fails closed to a short message.
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
  // The blob document inherits this manifest sandbox's egress-blocking CSP.
  // A second iframe sandbox gives the animation a separate opaque principal,
  // while allow-scripts retains the explicit on-chain animation capability.
  const frame = document.createElement("iframe");
  frame.id = "nft-animation-document";
  frame.title = "Collectible animation document";
  frame.referrerPolicy = "no-referrer";
  frame.setAttribute("sandbox", "allow-scripts");
  document.documentElement.style.height = "100%";
  document.body.style.height = "100%";
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  frame.style.border = "0";
  frame.style.display = "block";
  frame.style.height = "100%";
  frame.style.width = "100%";
  const source = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  frame.addEventListener("load", () => URL.revokeObjectURL(source), { once: true });
  frame.src = source;
  document.body.replaceChildren(frame);
}
