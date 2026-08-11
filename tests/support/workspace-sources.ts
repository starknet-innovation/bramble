/**
 * The set of shipped TypeScript sources, for conformance scans that must fail
 * the day a rule is broken in a file nobody thought to list.
 *
 * These scans used to walk a single `src/` tree. After the modular split the
 * shipped code lives in `apps/extension/src` plus one `src/` per workspace
 * under `packages/<group>/<workspace>`, so a scan hard-coding one root is not
 * merely stale — it silently passes over every module that moved, which is the
 * whole wallet. Roots are discovered from the directory tree rather than
 * listed, so a workspace added tomorrow is scanned tomorrow.
 *
 * Trust boundary: test-only. Reads the repository working tree and nothing
 * else. Fails loudly (the underlying `readdir`/`existsSync` throw or the root
 * list comes back short) rather than returning a silently narrowed scan.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/** Repository root, resolved from this file's own location. */
export const REPO_DIR: string = join(import.meta.dir, "../..");

/** The extension's own background/content/provider source root. */
export const EXTENSION_SRC_DIR: string = join(REPO_DIR, "apps/extension/src");

const packageSourceRoots = (): readonly string[] =>
  readdirSync(join(REPO_DIR, "packages"), { withFileTypes: true })
    .filter((group) => group.isDirectory())
    .flatMap((group) =>
      readdirSync(join(REPO_DIR, "packages", group.name), { withFileTypes: true })
        .filter((workspace) => workspace.isDirectory())
        .map((workspace) => join(REPO_DIR, "packages", group.name, workspace.name, "src")),
    )
    .filter((root) => existsSync(root));

/**
 * Every shipped source root: the extension app plus each workspace's `src/`.
 * Tests and tooling are deliberately excluded — only code that ships is bound
 * by the rules these scans enforce.
 */
export const WORKSPACE_SOURCE_ROOTS: readonly string[] = [
  EXTENSION_SRC_DIR,
  ...packageSourceRoots(),
];

const filesUnder = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return filesUnder(path);
    }
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });

/**
 * Absolute paths of every shipped `.ts` file across all source roots. Throws if
 * a root cannot be read, so a scan can never quietly cover nothing.
 */
export const workspaceSourceFiles = (): readonly string[] =>
  WORKSPACE_SOURCE_ROOTS.flatMap(filesUnder);

/** Repository-relative form of an absolute source path, for readable failures. */
export const repoRelative = (path: string): string => relative(REPO_DIR, path);
