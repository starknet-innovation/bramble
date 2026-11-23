/**
 * Fetches the previous Chrome release build for the upgrade E2E test
 * (`tests/e2e/upgrade-from-previous.e2e.ts`).
 *
 * Usage: `bun scripts/fetch-previous-release.ts <out-dir> [X.Y.Z]`
 *
 * Without a version it picks the newest published (non-draft) `vX.Y.Z`
 * release strictly below `package.json`'s version. It downloads
 * `bramble-<v>.zip` and its `.sha256` with `gh release download`, checks the
 * digest, unzips into `<out-dir>` (which must not exist yet), checks the
 * unpacked manifest carries that version, and prints `<out-dir>`. Any mismatch
 * exits non-zero with nothing left in `<out-dir>`. The digest is published
 * beside the zip, so it guards against a corrupt or swapped download, not a
 * compromised release. `gh` needs `GH_TOKEN` (or a login) to list releases.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SEMVER_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

const parts = (version: string): readonly number[] | undefined => {
  const match = SEMVER_TAG.exec(`v${version}`);
  return match ? match.slice(1).map(Number) : undefined;
};

const below = (a: readonly number[], b: readonly number[]): boolean => {
  for (const [index, value] of a.entries()) {
    const other = b[index] ?? 0;
    if (value !== other) return value < other;
  }
  return false;
};

/**
 * The newest `vX.Y.Z` tag strictly below `current`, or `undefined` when none
 * is. Tags in any other shape are ignored, so a prerelease suffix never wins.
 * Pure. Throws if `current` is not `X.Y.Z`.
 */
export const previousReleaseTag = (
  tags: readonly string[],
  current: string,
): string | undefined => {
  const ceiling = parts(current);
  if (!ceiling) throw new Error(`package version ${current} is not X.Y.Z`);
  let best: { tag: string; version: readonly number[] } | undefined;
  for (const tag of tags) {
    const version = SEMVER_TAG.test(tag) ? parts(tag.slice(1)) : undefined;
    if (version && below(version, ceiling) && (!best || below(best.version, version))) {
      best = { tag, version };
    }
  }
  return best?.tag;
};

const run = (command: readonly string[]): string => {
  const result = Bun.spawnSync([...command], { stderr: "inherit", stdout: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${command[0]} exited with ${result.exitCode}`);
  return result.stdout.toString();
};

const main = async (outArg: string | undefined, versionArg: string | undefined): Promise<void> => {
  if (!outArg) throw new Error("usage: fetch-previous-release.ts <out-dir> [X.Y.Z]");
  const out = resolve(outArg);
  // Required absent, so the cleanup on failure below can only remove what this run wrote.
  if (existsSync(out)) throw new Error(`${out} already exists; remove it first`);
  let tag: string | undefined;
  if (versionArg) {
    tag = parts(versionArg) ? `v${versionArg}` : undefined;
    if (!tag) throw new Error(`version ${versionArg} is not X.Y.Z`);
  } else {
    const pkg = (await Bun.file("package.json").json()) as { version: unknown };
    const listed = JSON.parse(
      run(["gh", "release", "list", "--limit", "100", "--json", "tagName,isDraft"]),
    ) as { tagName: string; isDraft: boolean }[];
    const tags = listed.filter((release) => !release.isDraft).map((release) => release.tagName);
    tag = previousReleaseTag(tags, String(pkg.version));
    if (!tag) throw new Error(`no release below ${String(pkg.version)}`);
  }
  const version = tag.slice(1);
  const zipName = `bramble-${version}.zip`;
  const download = await mkdtemp(join(tmpdir(), "bramble-previous-"));
  try {
    run(["gh", "release", "download", tag, "--dir", download, "--pattern", zipName]);
    run(["gh", "release", "download", tag, "--dir", download, "--pattern", `${zipName}.sha256`]);
    const expected = (await readFile(join(download, `${zipName}.sha256`), "utf8")).trim();
    const actual = createHash("sha256")
      .update(await readFile(join(download, zipName)))
      .digest("hex");
    if (expected !== `${actual}  ${zipName}`) {
      throw new Error(`${zipName} digest mismatch: expected "${expected}", got ${actual}`);
    }
    run(["unzip", "-q", join(download, zipName), "-d", out]);
    const manifest = (await Bun.file(join(out, "manifest.json")).json()) as { version: unknown };
    if (manifest.version !== version) {
      throw new Error(`unpacked manifest is ${String(manifest.version)}, expected ${version}`);
    }
  } catch (error) {
    await rm(out, { force: true, recursive: true });
    throw error;
  } finally {
    await rm(download, { force: true, recursive: true });
  }
  console.log(out);
};

if (import.meta.main) {
  await main(process.argv[2], process.argv[3]).catch((error: unknown) => {
    console.error(`fetch-previous-release: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
