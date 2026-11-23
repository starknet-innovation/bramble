/**
 * The Firefox and geckodriver builds the smoke runs, pinned by version and
 * SHA-256, and the install step that fetches them.
 *
 * CI (Linux x64) installs exactly these. A download whose digest differs is
 * deleted and the run fails: nothing unverified is executed. The digests were
 * recorded on 2026-11-23 — Firefox's from Mozilla's published `SHA256SUMS` for
 * the release (re-checked against the downloaded archive), geckodriver's from
 * its official GitHub release asset.
 *
 * Elsewhere (a developer's Mac), point `BRAMBLE_FIREFOX_BINARY` and
 * `BRAMBLE_GECKODRIVER` at local builds; the version floor below still applies.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FIREFOX_MIN_VERSION } from "../../apps/extension/firefox-manifest";

/** Pinned Firefox: the current release at recording, and at least the manifest's floor. */
const FIREFOX = {
  sha256: "844d8a77aa4672a08ded949b6206f84d91bb82f6637c090fd58c3126e9d44119",
  url: "https://archive.mozilla.org/pub/firefox/releases/160.0.1/linux-x86_64/en-US/firefox-160.0.1.tar.xz",
} as const;

/** Pinned geckodriver 0.37.1 (released 2026-07-20). */
const GECKODRIVER = {
  sha256: "e815130ea95983e162ae91843b48d3a3ce991735635fce83a647afde21e09f7e",
  url: "https://github.com/mozilla/geckodriver/releases/download/v0.37.1/geckodriver-v0.37.1-linux64.tar.gz",
} as const;

/** Absolute paths to the two executables the smoke starts. */
export type BrowserBinaries = { readonly firefox: string; readonly geckodriver: string };

const run = (command: string, args: readonly string[]): string => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.error}`);
  }
  return result.stdout;
};

const fetchVerified = async (
  pin: { readonly sha256: string; readonly url: string },
  dir: string,
): Promise<string> => {
  const response = await fetch(pin.url);
  if (!response.ok) throw new Error(`download failed (${response.status}): ${pin.url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== pin.sha256) {
    throw new Error(`SHA-256 mismatch for ${pin.url}: got ${digest}, pinned ${pin.sha256}`);
  }
  const file = join(dir, pin.url.slice(pin.url.lastIndexOf("/") + 1));
  await writeFile(file, bytes);
  return file;
};

// Headless Firefox still links GTK and friends; name what the image lacks
// instead of letting geckodriver report a bare "process exited". Libraries
// Firefox bundles beside libxul (NSS, its sandbox) are found at run time.
const assertLibrariesPresent = (firefoxDir: string): void => {
  const missing = run("ldd", [join(firefoxDir, "libxul.so")])
    .split("\n")
    .filter((line) => line.includes("not found"))
    .map((line) => line.trim())
    .filter((line) => !existsSync(join(firefoxDir, line.split(" ")[0] ?? "")));
  if (missing.length > 0) {
    throw new Error(`the runner image lacks Firefox's system libraries:\n${missing.join("\n")}`);
  }
};

const installPinned = async (dir: string): Promise<BrowserBinaries> => {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(
      "pinned Firefox builds are Linux x64 only; set BRAMBLE_FIREFOX_BINARY and BRAMBLE_GECKODRIVER",
    );
  }
  run("tar", ["-xJf", await fetchVerified(FIREFOX, dir), "-C", dir]);
  run("tar", ["-xzf", await fetchVerified(GECKODRIVER, dir), "-C", dir]);
  assertLibrariesPresent(join(dir, "firefox"));
  return { firefox: join(dir, "firefox", "firefox"), geckodriver: join(dir, "geckodriver") };
};

/**
 * Resolves the builds to run: both local overrides when set (both or neither),
 * otherwise the pinned builds installed into `dir`. Throws when Firefox is
 * older than the manifest's `strict_min_version`, since that would test a
 * browser the add-on refuses to install on.
 */
export const resolveBrowser = async (dir: string): Promise<BrowserBinaries> => {
  const firefox = process.env["BRAMBLE_FIREFOX_BINARY"];
  const geckodriver = process.env["BRAMBLE_GECKODRIVER"];
  if (Boolean(firefox) !== Boolean(geckodriver)) {
    throw new Error("set both BRAMBLE_FIREFOX_BINARY and BRAMBLE_GECKODRIVER, or neither");
  }
  const binaries = firefox && geckodriver ? { firefox, geckodriver } : await installPinned(dir);
  const version = run(binaries.firefox, ["--version"]).trim();
  const major = Number(/(\d+)\./.exec(version)?.[1]);
  if (!(major >= Number.parseInt(FIREFOX_MIN_VERSION, 10))) {
    throw new Error(`${version} is below the manifest floor ${FIREFOX_MIN_VERSION}`);
  }
  console.log(`Firefox: ${version}`);
  console.log(`geckodriver: ${run(binaries.geckodriver, ["--version"]).split("\n")[0]}`);
  return binaries;
};
