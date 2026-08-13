/**
 * Vendors and builds the upstream Krusty KMS WASM package used by the extension.
 *
 * `KRUSTY_KMS_REVISION` binds the source tree and is the pin that carries the
 * assurance: `scripts/check-krusty-adapter.ts` refuses to import a checkout that
 * is not on it.
 *
 * `KRUSTY_KMS_TOOLCHAIN` and the `--remap-path-prefix` flags below remove the
 * two largest sources of build-to-build variance — the rustc release, and the
 * builder's `CARGO_HOME`, rustup sysroot, and checkout paths, which rustc
 * otherwise embeds in panic metadata. They are kept because a build that varies
 * for no reason cannot be compared across machines at all, and because
 * reproducibility is a prerequisite for ever verifying these bytes. They do not
 * make the emitted `krusty_kms_wasm_bg.wasm` reproducible on their own: LLVM,
 * wasm-pack, and wasm-opt versions all still reach the output, which is why the
 * shipped wasm carries no digest pin today (see that gate's header, and
 * mc-wallet issue #235 for the closure path). The wasm-bindgen glue is
 * digest-pinned there, and a new revision changes it: rebuild and update that
 * literal in the same commit.
 */
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const repo = "https://github.com/starknet-innovation/krusty-kms.git";
const target = "vendor/krusty-kms";
const KRUSTY_KMS_REVISION = "fb0b274dd654f69a828dee653576416f5a650a01";
// Must stay equal to the `toolchain:` every workflow that vendors Krusty pins
// (.github/workflows/{ci,nightly,release-build,release-integration}.yml). One
// rustc release across every builder is what makes two builds of the pinned
// revision comparable at all, so this pin and those workflow pins move together.
const KRUSTY_KMS_TOOLCHAIN = "1.96.1";
const KRUSTY_WASM_PACK_VERSION = "0.13.1";

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
    `rustc ${KRUSTY_KMS_TOOLCHAIN} required for a comparable wasm build ` +
      `(rustup toolchain install ${KRUSTY_KMS_TOOLCHAIN} --target wasm32-unknown-unknown); ` +
      `found: ${version.split("\n")[0] ?? "none"}`,
  );
}

const wasmPackVersion = Bun.spawnSync(["wasm-pack", "--version"]).stdout.toString().trim();
if (wasmPackVersion !== `wasm-pack ${KRUSTY_WASM_PACK_VERSION}`) {
  throw new Error(
    `wasm-pack ${KRUSTY_WASM_PACK_VERSION} required for a comparable wasm build; ` +
      `found: ${wasmPackVersion.split("\n")[0] ?? "none"}`,
  );
}

const sysroot = rustc(["--print", "sysroot"]);
if (sysroot === "") {
  throw new Error("rustc sysroot unavailable; the wasm build paths cannot be remapped");
}
// Every absolute path rustc would otherwise bake into the artifact, mapped to a
// fixed name. `RUSTFLAGS` is whitespace-separated, so a builder whose paths
// contain whitespace cannot be remapped safely: fail closed rather than emit an
// artifact whose bytes silently depend on where it was built.
const remapped: readonly (readonly [string, string])[] = [
  [process.env["CARGO_HOME"] ?? resolve(homedir(), ".cargo"), "/cargo"],
  [sysroot, "/rust"],
  [resolve(target), "/build"],
];
for (const [path] of remapped) {
  if (/\s/.test(path)) {
    throw new Error(`cannot remap the wasm build: build path contains whitespace: ${path}`);
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
