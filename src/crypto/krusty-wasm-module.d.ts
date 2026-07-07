/**
 * Type shim for the packaged Krusty KMS module statically imported by the MV3 worker.
 */
declare module "*krusty_kms_wasm.js" {
  const init: unknown;
  export default init;
}
