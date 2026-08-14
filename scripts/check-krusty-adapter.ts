/**
 * Verifies the vendored Krusty KMS WASM package satisfies the wallet crypto boundary.
 *
 * Three checks run before the package is imported, and they are deliberately
 * described here in terms of what they leave open, because a supply-chain
 * control that is believed to prove more than it does is worse than none.
 *
 *  - The checkout must sit on the commit pinned in `scripts/vendor-krusty.ts`.
 *    A commit hash binds the whole source tree, so a substituted remote cannot
 *    answer with a different tree under the same id: the reviewed commit is the
 *    only source that can ship, which gives review a fixed target. It says
 *    nothing about whether that source is benign — a backdoor at the pinned
 *    commit passes.
 *  - The worktree must be clean. That proves source integrity only:
 *    `vendor/krusty-kms/.gitignore` ignores `crates/wasm/pkg/`, so
 *    `git status --porcelain` can never report a change to a shipped artifact.
 *  - The wasm-bindgen glue must match a reviewed SHA-256. wasm-bindgen derives
 *    that file from the crate's exported API alone — no paths, timestamps, or
 *    toolchain strings — so every builder of the pinned revision produces the
 *    same bytes and the digest is a real cross-machine check on the file that
 *    carries key material across the boundary.
 *
 * What is NOT established today is byte provenance of `krusty_kms_wasm_bg.wasm`
 * — the crypto core that actually executes, is copied into `dist/`, and is
 * zipped into `artifacts/`. `bun run vendor:krusty` compiles it locally, so its
 * bytes are a function of the builder's whole toolchain (rustc, LLVM,
 * wasm-pack, wasm-opt, and the paths that survive remapping), not of the pinned
 * source alone. The second round of MCW-V09-127 pinned a byte digest over it;
 * the literal could not hold across machines and failed release CI on the first
 * foreign builder, so it was removed — it verified nothing on any host but the
 * one that wrote it. Nothing here detects a tampered or miscompiled `pkg/`
 * produced after vendoring; the source pin and the vectors below are the whole
 * of the assurance, and Krusty KMS is trusted as first-party in the meantime.
 *
 * Closure path: consume Krusty KMS as a pinned, published npm package
 * (mc-wallet issue #235). The shipped wasm then arrives as a fetched artifact
 * covered by the lockfile's integrity hash, so its bytes are pinned by the same
 * mechanism as every other dependency instead of by a digest each builder has
 * to reproduce. Do not reintroduce a local-build byte digest ahead of that.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createKrustyKms } from "@mc-wallet/kms-krusty/adapter";
import { deriveAccount } from "@mc-wallet/vault/accounts";
import { DEFAULT_NETWORK, isStarkFieldElement } from "@mc-wallet/wallet-model/networks";
import { vendorProvenanceFailures, vendorRevisionPin } from "./vendor-pin-policy";

const checkout = "vendor/krusty-kms";
const wasmPackage = `${checkout}/crates/wasm/pkg/krusty_kms_wasm.js`;
const wasmBinary = `${checkout}/crates/wasm/pkg/krusty_kms_wasm_bg.wasm`;
const vendorScript = "scripts/vendor-krusty.ts";
// SHA-256 of the wasm-bindgen glue emitted for the pinned commit. wasm-bindgen
// derives it from the crate's exported API alone (no paths, timestamps, or
// toolchain strings), so it is reproducible wherever the pinned revision is
// built. Update it only together with KRUSTY_KMS_REVISION.
const expectedGlueDigest = "b24a945dbc39fa649e5953e8fa4a64c3e48072f87196a4e16840389ebf14439d";

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

for (const path of [wasmPackage, wasmBinary]) {
  if (!(await Bun.file(path).exists())) {
    throw new Error(`Krusty KMS runtime file missing: ${path}; run bun run vendor:krusty`);
  }
}

const git = async (args: string[]): Promise<string> => {
  const child = Bun.spawn(["git", ...args], { cwd: checkout, stderr: "inherit", stdout: "pipe" });
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) {
    throw new Error(
      `Krusty KMS provenance unavailable: git ${args.join(" ")} failed in ${checkout}`,
    );
  }
  return output.trim();
};

const artifactDigest = async (path: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

const provenanceFailures = vendorProvenanceFailures({
  // `wasmBinary` is deliberately absent: it is built on the spot by
  // `bun run vendor:krusty`, so no digest literal can hold across builders. See
  // the header, and mc-wallet issue #235 for the closure path.
  artifacts: [
    {
      digest: await artifactDigest(wasmPackage),
      expectedDigest: expectedGlueDigest,
      path: wasmPackage,
    },
  ],
  head: await git(["rev-parse", "HEAD"]),
  name: "Krusty KMS",
  pinnedRevision: vendorRevisionPin(
    await readFile(vendorScript, "utf8"),
    vendorScript,
    "KRUSTY_KMS_REVISION",
  ),
  worktreeStatus: await git(["status", "--porcelain"]),
});
if (provenanceFailures.length > 0) {
  throw new Error(provenanceFailures.join("; "));
}

const kms = createKrustyKms(await import(`../${wasmPackage}`));
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

if (
  account.networkId !== DEFAULT_NETWORK.id ||
  !isStarkFieldElement(account.address) ||
  !isStarkFieldElement(viewingKey) ||
  BigInt(viewingKey) === 0n ||
  ![signature.publicKey, signature.r, signature.s].every(isStarkFieldElement)
) {
  throw new Error("Krusty KMS returned an invalid Stark signature");
}

// Known-answer vectors. They are behavioural spot-checks, not provenance: one
// mnemonic, one derivation index, one message hash, one viewing-key input. A
// substituted module that reproduced these four answers and misbehaved on every
// other input would pass them, and no byte digest covers the crypto core they
// exercise (see the header). They are what stands between a wasm rebuilt from
// something other than the pinned source and a silent behaviour change: they
// fail closed on the likely accident — a revision or toolchain bump that moves
// derivation, signing, or viewing-key output — not on a targeted substitution.
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
