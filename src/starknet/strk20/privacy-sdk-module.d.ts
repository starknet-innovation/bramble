/**
 * Structural type shim for the pinned official browser SDK bundle. Keeping the
 * boundary narrow prevents SDK implementation types from spreading through
 * wallet code and lets tests inject a deterministic protocol double.
 */
declare module "*starknet-sdk.min.js" {
  export const Open: unique symbol;
  export const createPrivateTransfers: unknown;
}
