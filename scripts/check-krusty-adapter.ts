/**
 * Verifies the exact published Krusty KMS package before it enters the wallet.
 *
 * Bun's frozen lockfile pins the immutable npm tarball and its registry
 * integrity. This gate additionally pins both runtime files copied into the
 * extension, rejects package metadata or lifecycle-script drift, then runs the
 * wallet's known-answer and Nostr round-trip checks through the real adapter.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { deriveAccount } from "@bramble/vault/accounts";
import { DEFAULT_NETWORK, isStarkFieldElement } from "@bramble/wallet-model/networks";

const packageName = "@starknetfoundation/krusty-kms-wasm";
const packageVersion = "0.11.0";
const packageRoot = `node_modules/${packageName}`;
const packageManifest = `${packageRoot}/package.json`;
const wasmPackage = `${packageRoot}/krusty_kms_wasm.js`;
const wasmBinary = `${packageRoot}/krusty_kms_wasm_bg.wasm`;
const expectedRuntimeDigests: Readonly<Record<string, string>> = {
  [wasmPackage]: "b76e555eaf4edae057dff57f72c52533716f6bcb4c73418e4513934ce402e63e",
  [wasmBinary]: "d92e54274127096998f32d556779fe0352f88c1d70ce19da8ba34b71db7b7d0c",
};

// A published BIP-39 test phrase, never a wallet phrase: it exists so the
// vectors below are reproducible by anyone auditing a build.
const referenceMnemonic =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const referenceAccount = {
  address: "0x340cfbd6cf1d384e7029ccd7cdec84b22b53d2fcffdb005d499e580ec361069",
  publicKeyX: "0xb7ff7bf7404503b6df17fa28ea02dd529e58ddd0cfb3232db83ef27630f6aa",
  publicKeyY: "0x403f8f345048a2a3da2f834a14daab97f61e0c0dbb886a90674355f5b29c5d2",
} as const;
const referenceSignature = {
  r: "0x4bbe22478347f1672ccd19d540c47d77ec9dc52d8fb21aeacf8889dfd5282d3",
  s: "0x303baae9f9559ff686c55436408d771a51777c371f22e4db1e133a6c0384f4b",
} as const;
const referenceViewingKeyChainId = "0x534e5f5345504f4c4941";
const referenceViewingKeyPool = "0x123";
const referenceViewingKey = "0x27cae3ff78010cbec0f29c0c94420cc4d41ca326d664e510cca4dcc6082beb3";

const artifactDigest = async (path: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

const manifest = JSON.parse(await readFile(packageManifest, "utf8")) as Record<string, unknown>;
if (
  manifest["name"] !== packageName ||
  manifest["version"] !== packageVersion ||
  manifest["type"] !== "module" ||
  manifest["main"] !== "krusty_kms_wasm.js" ||
  Object.hasOwn(manifest, "browser") ||
  Object.hasOwn(manifest, "exports") ||
  Object.hasOwn(manifest, "module") ||
  JSON.stringify(manifest["files"]) !==
    JSON.stringify(["krusty_kms_wasm_bg.wasm", "krusty_kms_wasm.js", "krusty_kms_wasm.d.ts"]) ||
  Object.hasOwn(manifest, "scripts")
) {
  throw new Error(`Krusty KMS must be the script-free published ${packageName}@${packageVersion}`);
}
for (const [path, expectedDigest] of Object.entries(expectedRuntimeDigests)) {
  if ((await artifactDigest(path)) !== expectedDigest) {
    throw new Error(
      `Krusty KMS runtime does not match the published ${packageName}@${packageVersion}: ${path}`,
    );
  }
}

const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
const mnemonic = await kms.generateMnemonic(12);

if (!(await kms.validateMnemonic(mnemonic))) {
  throw new Error("Krusty KMS generated an invalid mnemonic");
}

const { account, privateKey } = await deriveAccount(kms, {
  accountContractType: "openzeppelin",
  mnemonic,
  networkId: DEFAULT_NETWORK.id,
});
const signature = await kms.signStarkHash(privateKey, "0x1");
const viewingKey = await kms.deriveStrk20ViewingKey(
  privateKey,
  referenceViewingKeyChainId,
  referenceViewingKeyPool,
);
const nostrPublicKey = await kms.deriveNostrPublicKey(mnemonic, 0, 0);
const giftWrap = await kms.wrapNostrApplicationData(
  mnemonic,
  0,
  0,
  nostrPublicKey,
  "bramble.check",
  "round-trip",
);
const opened = await kms.openNostrApplicationData(mnemonic, 0, 0, giftWrap);

if (
  account.networkId !== DEFAULT_NETWORK.id ||
  !isStarkFieldElement(account.address) ||
  !isStarkFieldElement(viewingKey) ||
  BigInt(viewingKey) === 0n ||
  opened.content !== "round-trip" ||
  opened.identifier !== "bramble.check" ||
  opened.senderPublicKey !== nostrPublicKey ||
  ![signature.publicKey, signature.r, signature.s].every(isStarkFieldElement)
) {
  throw new Error("Krusty KMS returned an invalid Stark signature");
}

// The hashes above establish bytes; these vectors establish the wallet-facing
// derivation, signing, viewing-key, and authenticated Nostr behavior expected
// from those bytes.
const { account: knownAccount, privateKey: knownPrivateKey } = await deriveAccount(kms, {
  accountContractType: "openzeppelin",
  mnemonic: referenceMnemonic,
  networkId: DEFAULT_NETWORK.id,
});
const knownSignature = await kms.signStarkHash(knownPrivateKey, "0x1");
const knownViewingKey = await kms.deriveStrk20ViewingKey(
  "0x1",
  referenceViewingKeyChainId,
  referenceViewingKeyPool,
);

if (
  knownAccount.address !== referenceAccount.address ||
  knownAccount.publicKeyX !== referenceAccount.publicKeyX ||
  knownAccount.publicKeyY !== referenceAccount.publicKeyY ||
  knownSignature.publicKey !== referenceAccount.publicKeyX ||
  knownSignature.r !== referenceSignature.r ||
  knownSignature.s !== referenceSignature.s ||
  knownViewingKey !== referenceViewingKey
) {
  throw new Error("Krusty KMS known-answer vectors do not match the reviewed build");
}
