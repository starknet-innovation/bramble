/**
 * Vendors and builds the upstream Krusty KMS WASM package used by the extension.
 */
import { mkdir } from "node:fs/promises";

const repo = "https://github.com/starknet-innovation/krusty-kms.git";
const target = "vendor/krusty-kms";
// A commit on upstream `main`, reachable and immutable — no longer a PR branch
// tip that could be rebased or squashed out from under this pin.
//
// This is the first pin to carry upstream #42, which exposes the two hashing
// stages either side of the signature so a Ledger can supply the middle step. It
// landed with a different shape than the branch this used to track: scoping is an
// additive `deriveScopedStrk20ViewingKey` rather than a new signature on
// `deriveStrk20ViewingKey`, and the fold now takes the public key and message
// hash so it verifies the signature instead of trusting the caller. The adapter
// tracks that shape; `check:krusty` pins both against the real wasm.
const KRUSTY_KMS_REVISION = "f1a036c78cdc2f09e173edd6ff4b19a307a44732";

const run = async (cmd: string[], cwd = "."): Promise<void> => {
  const child = Bun.spawn(cmd, { cwd, stderr: "inherit", stdout: "inherit" });
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed with exit code ${exitCode}`);
  }
};

await mkdir("vendor", { recursive: true });

if (!(await Bun.file(`${target}/Cargo.toml`).exists())) {
  await run(["git", "clone", "--filter=blob:none", "--no-checkout", repo, target]);
}

await run(["git", "fetch", "--depth=1", "origin", KRUSTY_KMS_REVISION], target);
await run(["git", "checkout", "--detach", KRUSTY_KMS_REVISION], target);
await run(["wasm-pack", "build", "crates/wasm", "--target", "web", "--out-dir", "pkg"], target);
