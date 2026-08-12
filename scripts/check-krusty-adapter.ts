/**
 * Verifies the vendored Krusty KMS WASM package satisfies the wallet crypto boundary.
 */

import { createKrustyKms } from "@mc-wallet/kms-krusty/adapter";
import { deriveAccount } from "@mc-wallet/vault/accounts";
import { DEFAULT_NETWORK, isStarkFieldElement } from "@mc-wallet/wallet-model/networks";

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
const viewingKey = await kms.deriveScopedStrk20ViewingKey(
  privateKey,
  "0x534e5f5345504f4c4941",
  "0x123",
);
// Known-answer vector for the SCOPED derivation. This is the check that catches a
// pin moving to a build where the adapter binds the unscoped export instead: the
// unscoped function ignores the extra arguments rather than failing, so only a
// fixed expected key can tell the two apart.
const referenceViewingKey = await kms.deriveScopedStrk20ViewingKey(
  "0x1",
  "0x534e5f5345504f4c4941",
  "0x123",
);

if (
  account.networkId !== DEFAULT_NETWORK.id ||
  !isStarkFieldElement(account.address) ||
  !isStarkFieldElement(viewingKey) ||
  BigInt(viewingKey) === 0n ||
  referenceViewingKey !== "0x27cae3ff78010cbec0f29c0c94420cc4d41ca326d664e510cca4dcc6082beb3" ||
  ![signature.publicKey, signature.r, signature.s].every(isStarkFieldElement)
) {
  throw new Error("Krusty KMS returned an invalid Stark signature");
}

// The Ledger ceremony's two stages, against the real WASM. Neither was covered
// here before, which is how an arity change on either could have reached the
// adapter unnoticed: both are bound dynamically by name, so only calling them
// proves the shape.
const chainId = "0x534e5f5345504f4c4941";
const poolAddress = "0x123";
const messageHash = await kms.strk20ViewingKeyMessageHash(chainId, poolAddress);
// Stand in for the device: sign the wallet-computed scope hash with a host key,
// then fold that signature the way the ceremony folds the device's.
const ceremonySignature = await kms.signStarkHash(privateKey, messageHash);
const foldedViewingKey = await kms.foldStrk20ViewingKey(
  ceremonySignature.publicKey,
  messageHash,
  ceremonySignature.r,
  ceremonySignature.s,
);

if (!isStarkFieldElement(messageHash) || BigInt(messageHash) === 0n) {
  throw new Error("Krusty KMS returned an invalid STRK20 viewing-key message hash");
}
if (!isStarkFieldElement(foldedViewingKey) || BigInt(foldedViewingKey) === 0n) {
  throw new Error("Krusty KMS folded an invalid STRK20 viewing key");
}

// The fold must verify (r, s) against the public key it is handed, not merely
// mix them: a signature that belongs to another key cannot be allowed to produce
// a usable viewing key. `deriveAccount` gave us a second real key to test with,
// so this uses a genuine non-signer public key rather than a malformed felt,
// which would only exercise the adapter's own input validation.
const otherKey = await kms.deriveStarknetKeypair(mnemonic, 0, 1);
if (otherKey.publicKeyX === ceremonySignature.publicKey) {
  throw new Error("Krusty KMS derived the same public key for two account indexes");
}
let rejectedForeignSigner = false;
try {
  await kms.foldStrk20ViewingKey(
    otherKey.publicKeyX,
    messageHash,
    ceremonySignature.r,
    ceremonySignature.s,
  );
} catch {
  rejectedForeignSigner = true;
}
if (!rejectedForeignSigner) {
  throw new Error("Krusty KMS folded a viewing key from a signature it could not verify");
}
