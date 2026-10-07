/**
 * Exact runtime file sets allowed in each packaged extension build.
 */
import { FIREFOX_EXCLUDED_FILES } from "../apps/extension/firefox-manifest";

/**
 * Exact runtime files allowed in the packaged MV3 extension.
 */
export const EXPECTED_RUNTIME_FILES = [
  "background/index.js",
  "brand/onboarding-landscape.webp",
  "content/index.js",
  "dependencies/krusty-kms/krusty_kms_wasm.js",
  "dependencies/krusty-kms/krusty_kms_wasm_bg.wasm",
  "icons/icon-128.png",
  "icons/icon-16.png",
  "icons/icon-24.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "ledger-grant.html",
  "ledger-grant/index.js",
  "manifest.json",
  "onboarding.html",
  "popup.html",
  "provider/inpage.js",
  "sandbox/render.html",
  "sandbox/render.js",
  "sidepanel.html",
  "sidepanel/index.js",
  "vendor/starknet-privacy/sdk/starknet-sdk.min.js",
] as const;

/**
 * Exact runtime files allowed in the packaged Firefox extension, derived from
 * the Chrome set so a new packaged file is reviewed once rather than twice. The
 * difference is the collectible renderer, which the Gecko manifest cannot
 * declare as sandboxed at this build's minimum Firefox — see
 * `apps/extension/firefox-manifest.ts`.
 */
export const FIREFOX_RUNTIME_FILES: readonly string[] = EXPECTED_RUNTIME_FILES.filter(
  (file) => !FIREFOX_EXCLUDED_FILES.includes(file),
);
