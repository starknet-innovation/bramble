/**
 * Content digest of a workspace tree, for containing an untrusted build.
 *
 * `git status --porcelain` omits every ignored path, and the paths a hostile
 * build would target to change what ships are ignored ones: `node_modules/`,
 * which supplies the code `build` bundles, `dist/`, the build output itself, and
 * the vendored trees `check:privacy` executes (Sherlock 256). This digest
 * covers every file, ignored or not, by content rather than timestamp, so a
 * write that restores the original modification time still changes it.
 * Symbolic links are recorded by target and never followed.
 */
import { lstat, readdir, readlink } from "node:fs/promises";
import { join, relative } from "node:path";

const HASH_BATCH = 64;

/**
 * Digests every file under `root` except the `.git` directory and the given
 * relative `excluded` paths (the directory the build is allowed to write).
 * Fails on an unreadable entry rather than skipping it.
 */
export const workspaceDigest = async (
  root: string,
  excluded: readonly string[],
): Promise<string> => {
  const skipped = new Set([".git", ...excluded]);
  const entries: string[] = [];
  const files: { readonly path: string; readonly relativePath: string; readonly mode: number }[] =
    [];
  const walk = async (dir: string): Promise<void> => {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name);
      const relativePath = relative(root, path);
      if (skipped.has(relativePath)) continue;
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) {
        entries.push(`link\0${relativePath}\0${await readlink(path)}`);
      } else if (stats.isDirectory()) {
        entries.push(`dir\0${relativePath}`);
        await walk(path);
      } else if (stats.isFile()) {
        files.push({ mode: stats.mode, path, relativePath });
      } else {
        entries.push(`other\0${relativePath}\0${stats.mode}`);
      }
    }
  };
  await walk(root);
  // Hashed in bounded parallel batches; the digest is order-independent of
  // completion because every entry carries its path and the list is sorted.
  for (let start = 0; start < files.length; start += HASH_BATCH) {
    const batch = files.slice(start, start + HASH_BATCH);
    const digests = await Promise.all(
      batch.map(async ({ path }) =>
        new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex"),
      ),
    );
    batch.forEach(({ mode, relativePath }, index) => {
      entries.push(`file\0${relativePath}\0${mode}\0${digests[index]}`);
    });
  }
  entries.sort();
  return new Bun.CryptoHasher("sha256").update(entries.join("\n")).digest("hex");
};
