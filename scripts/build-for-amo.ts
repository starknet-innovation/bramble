/**
 * Rebuilds the Firefox package from a source archive, for addons.mozilla.org.
 *
 * AMO's source builder runs `npm run build-for-amo` on Node.js LTS and compares
 * the result with the uploaded add-on. It has no Bun and no git history, and the
 * packaged bytes depend on both, so this script runs under plain Node and sets up
 * what BUILDING.md asks a human reviewer to set up by hand:
 *
 * - the exact Bun release named by `packageManager`, installed into a temporary
 *   directory with npm (another Bun produces different bytes, #352);
 * - a git repository on `main`, because `vendor:privacy` refuses to run outside
 *   one and any other branch name is stamped into the extension's name.
 *
 * It then runs the BUILDING.md steps unchanged and leaves `dist-firefox/` and
 * `artifacts/bramble-firefox-<version>.zip` (with its `.sha256`) behind. A
 * checkout that already has `.git` is left as it is.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const run = (command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void => {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { env, stdio: "inherit" });
};

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { packageManager?: unknown };
const pinned = /^bun@(\d+\.\d+\.\d+)$/.exec(String(manifest.packageManager))?.[1];
if (pinned === undefined) {
  throw new Error("package.json packageManager must pin an exact bun@X.Y.Z release");
}

// The privacy SDK is built with the Node and npm on PATH. BUILDING.md was
// verified on Node 24; a different LTS line may still work, so this warns.
if (process.versions.node.split(".")[0] !== "24") {
  console.warn(`warning: BUILDING.md is verified on Node.js 24, this is ${process.version}`);
}

if (!existsSync(".git")) {
  run("git", ["init", "--quiet", "-b", "main", "."]);
  run("git", ["add", "-A"]);
  run("git", [
    "-c",
    "user.name=build-for-amo",
    "-c",
    "user.email=build-for-amo@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "source archive",
  ]);
}

// The toolchain install must not depend on the machine's npm settings. `npm
// run` exports them as npm_config_* variables, which the nested install would
// read as its own flags (an `allow-scripts` setting fails it outright), so
// neither it nor the build steps, whose `vendor:privacy` runs `npm ci`, get
// any of them. Lifecycle scripts are skipped too, and Bun's one
// postinstall step, which puts the platform binary in place of a placeholder,
// is run explicitly. If that step did not happen, the version check below
// fails before anything is built.
const npmEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_config_")),
);
const toolchain = mkdtempSync(join(tmpdir(), "bramble-amo-"));
run(
  "npm",
  [
    "install",
    "--prefix",
    toolchain,
    "--no-save",
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    `bun@${pinned}`,
  ],
  npmEnv,
);
execFileSync(process.execPath, ["install.js"], {
  cwd: join(toolchain, "node_modules", "bun"),
  stdio: "inherit",
});
const env = {
  ...npmEnv,
  PATH: `${join(toolchain, "node_modules", ".bin")}${delimiter}${process.env["PATH"] ?? ""}`,
};
const version = execFileSync("bun", ["--version"], { encoding: "utf8", env }).trim();
if (version !== pinned) {
  throw new Error(`expected Bun ${pinned} on PATH, found ${version}`);
}

run("bun", ["install", "--frozen-lockfile"], env);
run("bun", ["run", "vendor:argent"], env);
run("bun", ["run", "vendor:privacy"], env);
run("bun", ["run", "package:extension:firefox"], env);
