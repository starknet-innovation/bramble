/** Packaged public-only SDK adapter; verified at build time, never fetched remotely. */
declare module "*pqb/sdk.mjs" {
  import type { PqbRuntime } from "@bramble/qsb/pqb-runtime";
  export const publicState: PqbRuntime["publicState"];
  export const validatePublicState: PqbRuntime["validatePublicState"];
  export const prepare: PqbRuntime["prepare"];
  export const finish: PqbRuntime["finish"];
}
