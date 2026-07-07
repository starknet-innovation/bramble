/**
 * Verifies the vendored Krusty KMS WASM package satisfies the wallet crypto boundary.
 */
import { createKrustyKms } from "../src/crypto/krusty";
import { DEFAULT_NETWORK, isStarkFieldElement } from "../src/starknet/networks";
import { deriveAccount } from "../src/wallet/accounts";

const wasmPackage = "vendor/krusty-kms/crates/wasm/pkg/krusty_kms_wasm.js";
const wasmBinary = "vendor/krusty-kms/crates/wasm/pkg/krusty_kms_wasm_bg.wasm";

for (const path of [wasmPackage, wasmBinary]) {
  if (!(await Bun.file(path).exists())) {
    throw new Error(`Krusty KMS runtime file missing: ${path}; run bun run vendor:krusty`);
  }
}

const kms = createKrustyKms(await import(`../${wasmPackage}`));
const mnemonic = await kms.generateMnemonic(12);

if (!(await kms.validateMnemonic(mnemonic))) {
  throw new Error("Krusty KMS generated an invalid mnemonic");
}

const { account, privateKey } = await deriveAccount(kms, {
  mnemonic,
  networkId: DEFAULT_NETWORK.id,
});
const signature = await kms.signStarkHash(privateKey, "0x1");

if (
  account.networkId !== DEFAULT_NETWORK.id ||
  !isStarkFieldElement(account.address) ||
  ![signature.publicKey, signature.r, signature.s].every(isStarkFieldElement)
) {
  throw new Error("Krusty KMS returned an invalid Stark signature");
}
