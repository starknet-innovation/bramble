/**
 * Pinned Chrome for Testing Beta for the nightly early-warning E2E run: the
 * next Chromium, weeks before users get it. Branded Chrome (stable and Beta)
 * ignores `--load-extension` since 137 and Playwright 1.63 has no
 * tip-of-tree channel, so the unbranded Chrome for Testing build is the only
 * next-version browser that loads `dist/` unpacked.
 *
 * Run directly (`bun run test:e2e:install:beta`) to download the pinned build.
 * The archive must match its recorded SHA-256 or nothing is extracted; an
 * unpinned platform fails. Bump the version and both digests together, from a
 * reviewed download of the current Beta in
 * https://googlechromelabs.github.io/chrome-for-testing/.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The pinned Chrome for Testing Beta version. */
export const CHROME_BETA_VERSION = "159.0.8154.13";

const PLATFORMS = {
  "darwin-arm64": {
    executable:
      "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    name: "mac-arm64",
    sha256: "c683005f829d10c4e25afce0c22a11e99bb6ecf15ea5d8a3ba4039e99fc2da89",
  },
  "linux-x64": {
    executable: "chrome-linux64/chrome",
    name: "linux64",
    sha256: "96bf3cc45c4767242e855cae5f28c0bf353ac3d7dbb38ab97598144a60e9035b",
  },
} as const;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const installDir = resolve(
  repoRoot,
  "node_modules/.cache/bramble-chrome-beta",
  CHROME_BETA_VERSION,
);

const platform = () => {
  const key = `${process.platform}-${process.arch}`;
  const pinned = PLATFORMS[key as keyof typeof PLATFORMS];
  if (pinned === undefined) {
    throw new Error(
      `No pinned Chrome for Testing Beta for ${key}; pinned: ${Object.keys(PLATFORMS)}`,
    );
  }
  return pinned;
};

/**
 * Path of the installed pinned Beta executable. Throws when this platform has
 * no pin or the build was never installed, so a run never falls back to
 * another browser.
 */
export const chromeBetaExecutable = (): string => {
  const path = resolve(installDir, platform().executable);
  if (!existsSync(path)) {
    throw new Error(
      `Chrome for Testing Beta ${CHROME_BETA_VERSION} is not installed; run bun run test:e2e:install:beta`,
    );
  }
  return path;
};

const install = async (): Promise<void> => {
  const { name, sha256 } = platform();
  if (existsSync(installDir)) {
    console.log(
      `Chrome for Testing Beta ${CHROME_BETA_VERSION} already installed at ${installDir}`,
    );
    return;
  }
  const url = `https://storage.googleapis.com/chrome-for-testing-public/${CHROME_BETA_VERSION}/${name}/chrome-${name}.zip`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const archive = new Uint8Array(await response.arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== sha256) throw new Error(`${url} has SHA-256 ${digest}, pinned ${sha256}`);
  // Extract beside the target and rename, so an interrupted run leaves no
  // half-written install that a later run would trust.
  await mkdir(dirname(installDir), { recursive: true });
  const staging = await mkdtemp(`${installDir}.partial-`);
  try {
    await writeFile(resolve(staging, "chrome.zip"), archive);
    const unzip = Bun.spawn(["unzip", "-q", "chrome.zip"], { cwd: staging, stderr: "inherit" });
    if ((await unzip.exited) !== 0) throw new Error("unzip failed");
    await rm(resolve(staging, "chrome.zip"));
    await rename(staging, installDir);
  } catch (error) {
    await rm(staging, { force: true, recursive: true });
    throw error;
  }
  console.log(`Installed Chrome for Testing Beta ${CHROME_BETA_VERSION} at ${installDir}`);
};

if (import.meta.main) await install();
