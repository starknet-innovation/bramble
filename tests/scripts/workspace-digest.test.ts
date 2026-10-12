/**
 * The containment digest around the untrusted privacy SDK build (Sherlock
 * 256). `git status --porcelain` cannot see ignored paths, and the paths that
 * decide what ships (`node_modules/`, `dist/`, the vendored trees) are all
 * ignored, so the digest must change on any write there, including one that
 * restores the original modification time, and must not change on writes
 * inside the build's own directory.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { workspaceDigest } from "../../scripts/workspace-digest";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const FIXTURE_PARENT = join(REPO_ROOT, "output");
const BUILD_DIR = "vendor/starknet-privacy";
const roots: string[] = [];

const tree = async (files: Readonly<Record<string, string>>): Promise<string> => {
  await mkdir(FIXTURE_PARENT, { recursive: true });
  const root = await mkdtemp(join(FIXTURE_PARENT, "workspace-digest-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
};

const baseline = {
  ".gitignore": "node_modules/\ndist/\n",
  "dist/background.js": "shipped();\n",
  "node_modules/esbuild/index.js": "module.exports = build;\n",
  "scripts/check-privacy.ts": "/** Gate. */\n",
  "src/index.ts": "/** Wallet. */\n",
  [`${BUILD_DIR}/sdk/dist/bundle.js`]: "bundle();\n",
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("workspaceDigest", () => {
  test("is stable for an unchanged tree", async () => {
    const root = await tree(baseline);
    expect(await workspaceDigest(root, [BUILD_DIR])).toBe(await workspaceDigest(root, [BUILD_DIR]));
  });

  const writes: ReadonlyArray<readonly [string, string]> = [
    ["an ignored dependency", "node_modules/esbuild/index.js"],
    ["the ignored build output", "dist/background.js"],
    ["a tracked verifier", "scripts/check-privacy.ts"],
  ];
  for (const [name, path] of writes) {
    test(`changes when the build writes ${name}`, async () => {
      const root = await tree(baseline);
      const before = await workspaceDigest(root, [BUILD_DIR]);
      await writeFile(join(root, path), "tampered();\n");
      expect(await workspaceDigest(root, [BUILD_DIR])).not.toBe(before);
    });
  }

  test("changes on a same-length write that restores the modification time", async () => {
    const root = await tree(baseline);
    const path = join(root, "node_modules/esbuild/index.js");
    const before = await workspaceDigest(root, [BUILD_DIR]);
    const { atime, mtime } = await stat(path);
    const original = await readFile(path, "utf8");
    await writeFile(path, original.replace("build", "evil!"));
    await utimes(path, atime, mtime);
    expect(await workspaceDigest(root, [BUILD_DIR])).not.toBe(before);
  });

  test("changes when the build adds a file or a link anywhere outside its directory", async () => {
    const root = await tree(baseline);
    const before = await workspaceDigest(root, [BUILD_DIR]);
    await writeFile(join(root, "node_modules/esbuild/extra.js"), "extra();\n");
    const added = await workspaceDigest(root, [BUILD_DIR]);
    expect(added).not.toBe(before);
    await symlink("/etc/hostname", join(root, "dist/link.js"));
    expect(await workspaceDigest(root, [BUILD_DIR])).not.toBe(added);
  });

  test("ignores writes inside the build's own directory and .git", async () => {
    const root = await tree({ ...baseline, ".git/HEAD": "ref: refs/heads/main\n" });
    const before = await workspaceDigest(root, [BUILD_DIR]);
    await writeFile(join(root, BUILD_DIR, "sdk/dist/bundle.js"), "rebuilt();\n");
    await writeFile(join(root, ".git/HEAD"), "ref: refs/heads/other\n");
    expect(await workspaceDigest(root, [BUILD_DIR])).toBe(before);
  });
});

describe("the privacy SDK vendoring step", () => {
  test("digests the checkout, ignored paths included, either side of the upstream build", async () => {
    const source = await readFile(join(REPO_ROOT, "scripts/vendor-privacy-sdk.ts"), "utf8");
    expect(source).toContain("workspaceDigest(");
    expect(source).not.toContain('"status", "--porcelain"');
    const before = source.indexOf("const before = await walletState();");
    const build = source.indexOf("BUILD_SOURCE], sdk");
    const after = source.indexOf("(await walletState()) !== before");
    expect(before).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(build);
  });
});
