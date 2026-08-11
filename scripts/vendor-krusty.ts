/**
 * Vendors and builds the upstream Krusty KMS WASM package used by the extension.
 *
 * The build is pinned twice over. `KRUSTY_KMS_REVISION` binds the source tree,
 * and `KRUSTY_KMS_TOOLCHAIN` plus the `--remap-path-prefix` flags below bind the
 * emitted bytes: rustc otherwise embeds the builder's `CARGO_HOME`, rustup
 * sysroot, and checkout paths in panic metadata, so every machine would produce
 * a different `krusty_kms_wasm_bg.wasm` and the digest of the shipped crypto
 * core could not be pinned at all.
 *
 * Anything that changes those bytes — a new revision, a new rustc release, a
 * changed flag — changes the digests `scripts/check-krusty-adapter.ts` enforces.
 * Rebuild and update them there in the same commit; the gate fails closed until
 * they agree, which is the intended behaviour for an unreviewed crypto core.
 */
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const repo = "https://github.com/starknet-innovation/krusty-kms.git";
const target = "vendor/krusty-kms";
const KRUSTY_KMS_REVISION = "fb0b274dd654f69a828dee653576416f5a650a01";
// Must stay equal to the `toolchain:` every workflow that vendors Krusty pins
// (.github/workflows/{ci,nightly,release-build,release-integration}.yml). A wasm
// digest is reproducible only for one rustc release, so this pin and those
// workflow pins move together or CI stops matching the reviewed artifact.
const KRUSTY_KMS_TOOLCHAIN = "1.96.1";

const run = async (cmd: string[], cwd = ".", env: Record<string, string> = {}): Promise<void> => {
  const child = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed with exit code ${exitCode}`);
  }
};

const toolchainEnv = { RUSTUP_TOOLCHAIN: KRUSTY_KMS_TOOLCHAIN };
const rustc = (args: string[]): string =>
  Bun.spawnSync(["rustc", ...args], { env: { ...process.env, ...toolchainEnv } })
    .stdout.toString()
    .trim();

const version = rustc(["--version"]);
if (!version.startsWith(`rustc ${KRUSTY_KMS_TOOLCHAIN} `)) {
  throw new Error(
    `rustc ${KRUSTY_KMS_TOOLCHAIN} required for a reproducible wasm digest ` +
      `(rustup toolchain install ${KRUSTY_KMS_TOOLCHAIN} --target wasm32-unknown-unknown); ` +
      `found: ${version.split("\n")[0] ?? "none"}`,
  );
}

const sysroot = rustc(["--print", "sysroot"]);
if (sysroot === "") {
  throw new Error("rustc sysroot unavailable; the wasm build paths cannot be remapped");
}
// Every absolute path rustc would otherwise bake into the artifact, mapped to a
// fixed name. `RUSTFLAGS` is whitespace-separated, so a builder whose paths
// contain whitespace cannot be remapped safely: fail closed rather than emit an
// artifact whose digest silently depends on where it was built.
const remapped: readonly (readonly [string, string])[] = [
  [process.env["CARGO_HOME"] ?? resolve(homedir(), ".cargo"), "/cargo"],
  [sysroot, "/rust"],
  [resolve(target), "/build"],
];
for (const [path] of remapped) {
  if (/\s/.test(path)) {
    throw new Error(`cannot pin the wasm digest: build path contains whitespace: ${path}`);
  }
}
const rustflags = remapped.map(([path, name]) => `--remap-path-prefix=${path}=${name}`).join(" ");

await mkdir("vendor", { recursive: true });

if (!(await Bun.file(`${target}/Cargo.toml`).exists())) {
  await run(["git", "clone", "--filter=blob:none", "--no-checkout", repo, target]);
}

await run(["git", "fetch", "--depth=1", "origin", KRUSTY_KMS_REVISION], target);
await run(["git", "checkout", "--detach", KRUSTY_KMS_REVISION], target);
await run(["wasm-pack", "build", "crates/wasm", "--target", "web", "--out-dir", "pkg"], target, {
  ...toolchainEnv,
  RUSTFLAGS: rustflags,
});
