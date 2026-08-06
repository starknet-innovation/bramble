/**
 * Exact runtime files allowed in the packaged MV3 extension.
 */
export const EXPECTED_RUNTIME_FILES = [
  "background/index.js",
  "content/index.js",
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
  "vendor/krusty-kms/pkg/krusty_kms_wasm.js",
  "vendor/krusty-kms/pkg/krusty_kms_wasm_bg.wasm",
  "vendor/multisig/multisig.contract_class.json",
  "vendor/starknet-privacy/sdk/starknet-sdk.min.js",
] as const;
