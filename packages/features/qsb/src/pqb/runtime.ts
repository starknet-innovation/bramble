/** The pinned SDK's public verification and selected-witness assembly capability. No seed-taking calls. */
import type { PqbPrepared, PqbPublicMaterial, PqbWitness } from "@bramble/wallet-model/pqb";
import type { QsbSolution } from "../withdrawal/binding";
import type { QsbWithdrawalManifest } from "../withdrawal/manifest";
/** Inputs are already parsed by the coordinator boundary; any SDK refusal throws before disclosure. */
export type PqbRuntime = {
  readonly publicState: (material: PqbPublicMaterial) => string;
  readonly validatePublicState: (text: string) => boolean;
  readonly prepare: (
    material: PqbPublicMaterial,
    manifest: QsbWithdrawalManifest,
    solution: QsbSolution,
  ) => PqbPrepared;
  readonly finish: (
    material: PqbPublicMaterial,
    prepared: PqbPrepared,
    witness: PqbWitness,
  ) => string;
};
