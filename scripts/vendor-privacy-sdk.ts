/**
 * Vendors the pinned official Starknet privacy SDK browser bundle.
 *
 * Trust boundary: everything under `vendor/starknet-privacy` is untrusted
 * upstream code that this repository binds by commit. The browser bundle is
 * produced by executing the pinned upstream build source with the very Bun
 * binary already running this file, against the exact esbuild release recorded
 * in upstream's lockfile. Upstream's own package script is deliberately never
 * invoked: it hands the compile to a TypeScript runner it names but does not
 * lock, so a registry — not a pin — would choose the code that executes, and it
 * would execute with write access to this checkout *before* `check:privacy`,
 * `build`, or `package:extension` verify anything.
 *
 * Fails closed. A lockfile that does not carry the build tool with an integrity
 * hash, a build tool whose installed version differs from that lock, a non-zero
 * build exit, or an upstream build that modified the wallet checkout each throw
 * before any artifact is offered to `check:privacy`.
 */
import { mkdir, readFile } from "node:fs/promises";
import { lockedPackageFailures, privacyBuildPackages } from "./vendor-pin-policy";
import { workspaceDigest } from "./workspace-digest";

const repo = "https://github.com/starkware-libs/starknet-privacy.git";
const target = "vendor/starknet-privacy";
const sdk = `${target}/sdk`;
const lockPath = `${sdk}/package-lock.json`;
const PRIVACY_SDK_REVISION = "b40bf109c8e5b97d9d6e8ec6db48b16b9d10a106";
// The pinned upstream build source. Its contents are covered by the commit pin
// above; the only thing this file supplies is a locked runtime for it.
const BUILD_SOURCE = "scripts/build-browser.ts";

const run = async (
  command: string[],
  cwd = ".",
  env: Readonly<Record<string, string>> | undefined = undefined,
): Promise<void> => {
  const child = Bun.spawn(command, {
    cwd,
    ...(env === undefined ? {} : { env }),
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
  }
};

// Content digest of the whole wallet checkout outside the build's own vendored
// tree, ignored paths included. Captured either side of the upstream build so
// a build that reaches out of its own directory and edits wallet source, a
// build script, a verifier, node_modules or dist/ is refused instead of being
// blessed by the artifact digests that run afterwards. Porcelain status could
// not see ignored paths, which are exactly the ones that decide what ships
// (Sherlock 256).
const walletState = async (): Promise<string> => {
  try {
    return await workspaceDigest(".", [target]);
  } catch {
    throw new Error("cannot snapshot the wallet checkout; refusing to run the upstream build");
  }
};

const installedVersion = async (name: string): Promise<string> => {
  const manifest = Bun.file(`${sdk}/node_modules/${name}/package.json`);
  if (!(await manifest.exists())) {
    throw new Error(`privacy SDK build tool is not installed from the lockfile: ${name}`);
  }
  const parsed = JSON.parse(await manifest.text()) as { readonly version?: unknown };
  if (typeof parsed.version !== "string") {
    throw new Error(`privacy SDK build tool has no readable version: ${name}`);
  }
  return parsed.version;
};

await mkdir("vendor", { recursive: true });
if (!(await Bun.file(`${sdk}/package.json`).exists())) {
  await run(["git", "clone", "--filter=blob:none", "--no-checkout", repo, target]);
}
await run(["git", "fetch", "--depth=1", "origin", PRIVACY_SDK_REVISION], target);
await run(["git", "checkout", "--detach", PRIVACY_SDK_REVISION], target);
// `npm ci` installs the lockfile graph exactly and refuses a manifest the lock
// does not cover; `--ignore-scripts` keeps dependency lifecycle hooks out of
// the install. Nothing after this line may reach the network.
await run(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], sdk);

const lockFailures = lockedPackageFailures({
  lock: JSON.parse(await readFile(lockPath, "utf8")) as unknown,
  lockPath,
  packages: await Promise.all(
    privacyBuildPackages(process.platform, process.arch).map(async (name) => ({
      name,
      version: await installedVersion(name),
    })),
  ),
});
if (lockFailures.length > 0) {
  throw new Error(lockFailures.join("; "));
}

// The upstream build is untrusted code, so it runs with a minimal environment —
// no registry tokens, no CI credentials — and with Bun's runtime auto-install
// disabled, so an import the lockfile does not cover fails the build instead of
// fetching a package mid-compile.
const before = await walletState();
await run([process.execPath, "--no-install", BUILD_SOURCE], sdk, {
  HOME: process.env["HOME"] ?? "",
  LANG: process.env["LANG"] ?? "C",
  PATH: process.env["PATH"] ?? "",
  TMPDIR: process.env["TMPDIR"] ?? "/tmp",
});
if ((await walletState()) !== before) {
  throw new Error(
    "the upstream privacy SDK build modified the wallet checkout; discard this workspace",
  );
}
