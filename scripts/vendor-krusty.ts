/**
 * Vendors and builds the upstream Krusty KMS WASM package used by the extension.
 */
import { mkdir } from "node:fs/promises";

const repo = "https://github.com/starknet-innovation/krusty-kms.git";
const target = "vendor/krusty-kms";
const KRUSTY_KMS_REVISION = "fb0b274dd654f69a828dee653576416f5a650a01";

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
