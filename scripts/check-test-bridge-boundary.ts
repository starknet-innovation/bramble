/**
 * Fails `check` when anything under `apps/` or `packages/` imports or names a
 * test-only root (`TEST_ONLY_ROOTS`): the Speculos Ledger bridge or the
 * vendor-dataset tooling. Scans every text source, not only TypeScript, so a
 * `.js` shim, an HTML page or a build script cannot route around it.
 */
import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { SHIPPED_ROOTS, testBridgeBoundaryFailures } from "./test-bridge-boundary-policy";
import { sourceImports } from "./workspace-architecture-imports";
import { EXCLUDED_DIRECTORIES } from "./workspace-architecture-policy";

const SCANNED = new Set([".cjs", ".css", ".html", ".js", ".json", ".mjs", ".ts", ".tsx"]);
const SCRIPT = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);

const walk = async (directory: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (EXCLUDED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (SCANNED.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
};

const repositoryRoot = resolve(".");
const failures: string[] = [];
let scanned = 0;
for (const root of SHIPPED_ROOTS) {
  for (const file of await walk(root)) {
    scanned += 1;
    const text = await readFile(file, "utf8");
    const specifiers = SCRIPT.has(extname(file)) ? sourceImports(file, text).specifiers : [];
    failures.push(...testBridgeBoundaryFailures({ file, repositoryRoot, specifiers, text }));
  }
}
// An empty scan would pass vacuously (wrong working directory, renamed roots).
if (scanned < 100) {
  failures.push(`only ${scanned} shipped files scanned; run from the repository root`);
}
if (failures.length > 0) {
  throw new Error(failures.join("\n"));
}
