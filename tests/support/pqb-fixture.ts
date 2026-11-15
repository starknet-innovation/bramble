/** Public pinned SDK assembly vector. It is not a completed puzzle solve and must never hold funds. */

import type { PqbRuntime } from "@bramble/qsb/pqb-runtime";
import type { PqbPrepared, PqbPublicMaterial, PqbWitness } from "@bramble/wallet-model/pqb";
/** Loads the independent reference bytes, without deriving the expected result from the adapter under test. */
export const pqbFixture = async (): Promise<{
  readonly mnemonic: string;
  readonly index: number;
  readonly material: PqbPublicMaterial;
  readonly publicStateJson: string;
  readonly prepared: PqbPrepared;
  readonly witness: PqbWitness;
  readonly raw: string;
}> => Bun.file(new URL("../fixtures/pqb/assembly.json", import.meta.url)).json();
/** Imports exactly the checked bundle the extension ships. Tests fail if vendoring has not run. */
export const pqbSdk = async (): Promise<PqbRuntime> => {
  const path = new URL("../../vendor/pqb-built/sdk.mjs", import.meta.url).href;
  return import(path);
};
