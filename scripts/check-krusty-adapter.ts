/**
 * Verifies the vendored Krusty KMS WASM package satisfies the wallet crypto boundary.
 *
 * Provenance is established before the package is imported. Both shipped
 * artifacts are digest-pinned: `krusty_kms_wasm_bg.wasm`, the crypto core that
 * actually executes, and the wasm-bindgen glue that carries key material across
 * the boundary. The wasm digest holds only because `scripts/vendor-krusty.ts`
 * pins the rustc release and remaps every absolute build path out of the
 * artifact; a build made any other way is not the reviewed one and must fail
 * here. Update either digest only together with the pins that produced it.
 *
 * Two weaker checks sit alongside them. The checkout must sit on the commit
 * pinned in `scripts/vendor-krusty.ts` (a commit hash binds the whole source
 * tree, so a substituted remote cannot answer with a different tree under the
 * same id), and its worktree must carry no local modification. The worktree
 * check proves source integrity only: `vendor/krusty-kms/.gitignore` ignores
 * `crates/wasm/pkg/`, so `git status --porcelain` can never report a change to
 * either shipped artifact. Artifact integrity rests entirely on the digests.
 *
 * What the digests prove, stated exactly, because a supply-chain control that
 * is believed to prove more than it does is worse than none:
 *
 *  - They prove the bytes about to be imported here, copied into `dist/`, and
 *    zipped into `artifacts/` are byte-identical to the ones a reviewer built
 *    from `KRUSTY_KMS_REVISION` with `KRUSTY_KMS_TOOLCHAIN`. Any substitution
 *    after vendoring — a tampered `pkg/`, a stale artifact from another
 *    revision, a locally patched crate — fails this gate before the module can
 *    execute. That is the property MCW-V09-127 found missing.
 *  - They do NOT prove the upstream source is correct or benign. A backdoor
 *    present at the pinned commit produces a matching digest. What the pin buys
 *    is that the reviewed commit is the only thing that can ship, so review has
 *    a fixed target.
 *  - They are not independently attested. The expected values are literals a
 *    maintainer wrote after building; anyone can re-derive them by rebuilding on
 *    the pinned toolchain, and CI does exactly that on every run, but no third
 *    party signs them. Trust here is "the pinned build is reproducible and CI
 *    keeps reproducing it", not "an external authority vouches for these bytes".
 *  - Reproducibility holds only for the pinned rustc release with the build
 *    paths remapped. A different toolchain is not a tampering signal and not a
 *    pass; it is a mismatch this gate reports so the divergence is investigated
 *    rather than absorbed.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createKrustyKms } from "../src/crypto/krusty";
import { DEFAULT_NETWORK, isStarkFieldElement } from "../src/starknet/networks";
import { deriveAccount } from "../src/wallet/accounts";
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
// SHA-256 of the crypto core emitted for the pinned commit by the pinned rustc
// release with the build paths remapped (see scripts/vendor-krusty.ts). Two
// clean builds from independent target directories produced these exact bytes,
// and the artifact carries no builder-specific string: only `/cargo`, `/rust`,
// and the rustc release id remain. Update it only together with
// KRUSTY_KMS_REVISION or KRUSTY_KMS_TOOLCHAIN, and only after re-reviewing the
// build it came from.
const expectedWasmDigest = "da8ae703a2b0774f7cd09ee2911248928b24e11dfa59e52cec7fe132475f72d1";

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
  artifacts: [
    {
      digest: await artifactDigest(wasmBinary),
      expectedDigest: expectedWasmDigest,
      path: wasmBinary,
    },
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
// other input would pass them — the digests above, not these vectors, are what
// bind the shipped bytes. They are kept because they fail closed on the far more
// likely accident: a revision or toolchain bump that changes derivation,
// signing, or viewing-key behaviour while every digest is dutifully updated.
const { account: knownAccount, privateKey: knownPrivateKey } = await deriveAccount(kms, {
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
