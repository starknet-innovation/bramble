/**
 * Exact runtime files allowed in the packaged MV3 extension.
 */
export const EXPECTED_RUNTIME_FILES = [
  "background/index.js",
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
