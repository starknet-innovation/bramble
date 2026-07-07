/**
 * Exact runtime files allowed in the packaged MV3 extension.
 */
export const EXPECTED_RUNTIME_FILES = [
  "background/index.js",
  "content/index.js",
  "manifest.json",
  "popup.html",
  "popup/index.js",
  "provider/inpage.js",
  "vendor/krusty-kms/pkg/krusty_kms_wasm.js",
  "vendor/krusty-kms/pkg/krusty_kms_wasm_bg.wasm",
] as const;
