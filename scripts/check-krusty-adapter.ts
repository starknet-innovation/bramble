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
const packageVersion = "0.15.0";
const packageRoot = `node_modules/${packageName}`;
const packageManifest = `${packageRoot}/package.json`;
const wasmPackage = `${packageRoot}/krusty_kms_wasm.js`;
const wasmBinary = `${packageRoot}/krusty_kms_wasm_bg.wasm`;
const expectedRuntimeDigests: Readonly<Record<string, string>> = {
  [wasmPackage]: "59223955d6ef33c4d629369021b9b05f1005c6daddf268d2ca5b357a961b007c",
  [wasmBinary]: "f3faef93b41afe4e30c19fb8bd241f04c2c2c6ee418719ebaebfdb911b3e65a1",
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
  !("publicKeyY" in knownAccount) ||
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

// Quantum-safe Bitcoin and Bitcoin known answers, all from public test phrases.
// The QSB roots and commitments are the draft BIP's `reference.py` values for
// "all all … all" (QSB-HORS-v1, net 0), the mnemonic-level vectors Krusty's
// own suite pins; the BIP's raw-key test vault (root 9b257b6a…) has no phrase,
// so no mnemonic export can reach it. The P2WPKH address and key are BIP-84's
// published `m/84'/0'/0'/0/0` vector. The BIP-322 proof is this build's
// deterministic (RFC 6979) answer for the message below, which bip322-js 4.0.0
// — the verifier the QSB coordinator runs — accepts in its unprefixed form.
const qsbReferencePhrase = "all all all all all all all all all all all all";
const bip84Phrase = `${"abandon ".repeat(11)}about`;
const bip84Vector = {
  address: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
  publicKey: "0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c",
} as const;
const bip322Message = [
  "QSB Vault sign-in",
  "Origin: https://d1pjwwq89sze3g.cloudfront.net",
  `Address: ${bip84Vector.address}`,
  "Network: bitcoin-mainnet",
  "Nonce: 3f1c2b9e-4d5a-4b6c-8d7e-9f0a1b2c3d4e",
  "Expires: 2026-11-04T12:05:00.000Z",
  "This signature authorizes this session only. It does not authorize a Bitcoin transaction.",
].join("\n");
const bip322Proof =
  "AkcwRAIgMoSEWC47IAAwzhOwoKVMAZPor0A0exlpE+W8y/ISUbMCIBE99KJ0NOeb5x1YFb+AyRRqXBB71MzY3dkWp2PKWx7iASEDMNVP0N1CCm5fjTYk9fNILK41D3nV8HU79b7vnC2Rrzw=";

const qsbVault0 = await kms.deriveQsbCommitments(qsbReferencePhrase, 0);
const qsbVaultMax = await kms.deriveQsbCommitments(qsbReferencePhrase, 2 ** 31 - 1);
const owner = await kms.deriveBitcoinP2wpkhKeypair(bip84Phrase, 0, 0, 0);
const proof = await kms.signBip322SimpleUnprefixed(owner.privateKey, owner.address, bip322Message);
if (
  qsbVault0.root !== "11f1da69fa1ca2e5f9b23a4416c7c1be994933d2d8d06d5cf80dc4be02e0d3c1" ||
  qsbVault0.round0[0] !== "296a1cf12ce73e492d0c7ff22b389d2b9ca3abaa" ||
  qsbVault0.round0[149] !== "6d1121d94beaa3734c741ee43424ba1c9f03964e" ||
  qsbVault0.round1[0] !== "b84006e49e98aca181a416c4e0e4220c60248917" ||
  qsbVault0.round1[149] !== "2d62908d953c4fa50a41d27627413be3b875b997" ||
  qsbVaultMax.root !== "a4b150a02e955b647ade44d3cdfd72c6faf0f0a1c0692848ab6efae4df5b3b9e" ||
  owner.address !== bip84Vector.address ||
  owner.publicKey !== bip84Vector.publicKey ||
  proof !== bip322Proof
) {
  throw new Error("Krusty KMS QSB and Bitcoin known answers do not match the reviewed build");
}
