/** Privileged PQB capability. Only selected witness material leaves Krusty after durable exposure. */
import type { PqbDisclosureRequest, PqbPublicMaterial } from "@bramble/wallet-model/pqb";
/** Only the selected witnesses; never retain or send through extension messages. */
export type PqbDisclosure = {
  readonly round0: readonly string[];
  readonly round1: readonly string[];
  readonly menus: readonly string[];
  readonly cosignature: string;
};
/** Public transaction binding returned by Krusty's opaque request. */
export type PqbRequestInfo = {
  readonly digest: string;
  readonly cosigSighash: string;
  readonly stageSighashes: readonly string[];
};
/** Re-derives the same child inside WASM per call and disposes every handle, even on failure. */
export type PqbKms = {
  readonly material: (mnemonic: string, v: number) => Promise<PqbPublicMaterial>;
  readonly prepare: (
    mnemonic: string,
    v: number,
    request: PqbDisclosureRequest,
  ) => Promise<PqbRequestInfo>;
  /** Call only after the exact request digest is durably exposed; Krusty is stateless. */
  readonly authorize: (
    mnemonic: string,
    v: number,
    request: PqbDisclosureRequest,
  ) => Promise<PqbDisclosure>;
};
