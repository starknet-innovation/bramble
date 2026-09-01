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
import { createKrustyKms } from "@mc-wallet/kms-krusty/adapter";
import { deriveAccount } from "@mc-wallet/vault/accounts";
import { DEFAULT_NETWORK, isStarkFieldElement } from "@mc-wallet/wallet-model/networks";
import { CallData, hash } from "starknet";

const packageName = "@starknetfoundation/krusty-kms-wasm";
const packageVersion = "0.10.0";
const packageRoot = `node_modules/${packageName}`;
const packageManifest = `${packageRoot}/package.json`;
const wasmPackage = `${packageRoot}/krusty_kms_wasm.js`;
const wasmBinary = `${packageRoot}/krusty_kms_wasm_bg.wasm`;
const expectedRuntimeDigests: Readonly<Record<string, string>> = {
  [wasmPackage]: "a3e2d11f8ebae305341a65955b36b6f8869fdb28c8775c0754e36660cc00dfc9",
  [wasmBinary]: "0f851abcc7ca23f95e23c182fdcc10ad165da21dd1f71437eb314fd72bc2af51",
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
const viewingKey = await kms.deriveScopedStrk20ViewingKey(
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
  "mc-wallet.check",
  "round-trip",
);
const opened = await kms.openNostrApplicationData(mnemonic, 0, 0, giftWrap);

if (
  account.networkId !== DEFAULT_NETWORK.id ||
  !isStarkFieldElement(account.address) ||
  !isStarkFieldElement(viewingKey) ||
  BigInt(viewingKey) === 0n ||
  opened.content !== "round-trip" ||
  opened.identifier !== "mc-wallet.check" ||
  opened.senderPublicKey !== nostrPublicKey ||
  ![signature.publicKey, signature.r, signature.s].every(isStarkFieldElement)
) {
  throw new Error("Krusty KMS returned an invalid Stark signature");
}

// The hashes above establish bytes; these vectors establish the wallet-facing
// derivation, signing, viewing-key, and authenticated Nostr behavior expected
// from those bytes.
//
// `referenceViewingKey` is also what catches a build where the adapter bound the
// KMS's *unscoped* `deriveStrk20ViewingKey`: that function ignores the extra
// arguments rather than failing, so only a pinned expected key tells the two apart.
const { account: knownAccount, privateKey: knownPrivateKey } = await deriveAccount(kms, {
  accountContractType: "openzeppelin",
  mnemonic: referenceMnemonic,
  networkId: DEFAULT_NETWORK.id,
});
const knownSignature = await kms.signStarkHash(knownPrivateKey, "0x1");
const knownViewingKey = await kms.deriveScopedStrk20ViewingKey(
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

// The account address, cross-checked against an independent implementation.
//
// This is the guard whose absence let a KMS bump silently move every derived
// address: upstream 0.6.0 changed `derive_oz_account_address`'s default salt from
// 0 to the public key — same signature, no error — and the only assertion here was
// that the address looked like a felt. A deployed address is immutable, so
// "looks like a felt" is worthless; it has to be the RIGHT felt.
//
// starknet.js computes the same counterfactual address from the same inputs, so
// agreement between two independent implementations pins the salt, the
// constructor calldata, and the address hash at once — and unlike a hardcoded
// constant it cannot be "fixed" by pasting in whatever the new build returned.
const expectedAddress = hash.calculateContractAddressFromHash(
  "0x0",
  account.classHash,
  CallData.compile([account.publicKeyX]),
  0,
);
if (BigInt(account.address) !== BigInt(expectedAddress)) {
  throw new Error(
    `Krusty KMS derived ${account.address} for the salt-0 OZ account address; starknet.js derives ${expectedAddress}. ` +
      "Every account already deployed by this wallet lives at the salt-0 address, so this mismatch would strand all of them.",
  );
}
