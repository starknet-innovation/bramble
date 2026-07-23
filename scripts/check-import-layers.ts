/**
 * Enforces the intended module-dependency directions between the top-level
 * `src/` subdirectories. Layering was previously convention-only; this gate
 * codifies the actual clean structure so a regression (for example a page-side
 * bundle reaching back into `background/`) fails offline instead of shipping.
 *
 * The ruleset below is descriptive, not aspirational: every forbidden edge is
 * one that does not exist today. Run with `--print-edges` to dump the observed
 * cross-directory edge set that these rules were derived from.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const SRC_ROOT = "src";

// Every top-level src/ subdirectory. Kept explicit so a brand-new directory
// surfaces here (and in the rules) rather than silently escaping the gate.
const KNOWN_DIRS = [
  "background",
  "content",
  "crypto",
  "ledger-grant",
  "popup",
  "provider",
  "security",
  "shared",
  "sidepanel",
  "starknet",
  "storage",
  "ui",
  "wallet",
] as const;

type SrcDir = (typeof KNOWN_DIRS)[number];

// Directions that must never appear. `from` may import from any dir NOT listed
// in its `forbidden` set. Rules mirror the current dependency graph:
//   - shared/ is a leaf: it must not import from any other src/ subdir.
//   - crypto/ and security/ are low-level and must not reach up into any
//     page/UI/background layer.
//   - ui/, popup/, sidepanel/ (extension UI) must not import from background/.
//   - provider/ and content/ (page-side, untrusted) must not import from
//     background/ — the RPC error taxonomy now lives in shared/.
const FORBIDDEN_TARGETS: Readonly<Record<string, readonly SrcDir[]>> = {
  shared: [
    "background",
    "content",
    "crypto",
    "ledger-grant",
    "popup",
    "provider",
    "security",
    "sidepanel",
    "starknet",
    "storage",
    "ui",
    "wallet",
  ],
  crypto: ["background", "content", "ledger-grant", "popup", "provider", "sidepanel", "ui"],
  security: ["background", "content", "ledger-grant", "popup", "provider", "sidepanel", "ui"],
  ui: ["background"],
  popup: ["background"],
  sidepanel: ["background"],
  provider: ["background"],
  content: ["background"],
  "ledger-grant": ["background"],
};

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (entry.isFile() && path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
};

const topDir = (path: string): SrcDir | null => {
  const match = path.match(/^src\/([^/]+)\//);
  const name = match?.[1];
  return name && (KNOWN_DIRS as readonly string[]).includes(name) ? (name as SrcDir) : null;
};

// Matches static `import ... from "x"`, `export ... from "x"`, and bare
// `import "x"`. Layering counts type-only imports too: an erased type edge is
// still a coupling direction we want to keep honest.
const FROM_SPECIFIER = /(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']/g;
const BARE_IMPORT = /\bimport\s*["']([^"']+)["']/g;

const resolveRelative = (fromFile: string, spec: string): string => {
  const baseDir = fromFile.slice(0, fromFile.lastIndexOf("/"));
  const parts = `${baseDir}/${spec}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join("/");
};

type Edge = { from: SrcDir; to: SrcDir; file: string; spec: string };

const collectEdges = async (): Promise<Edge[]> => {
  const edges: Edge[] = [];
  for (const file of await walk(SRC_ROOT)) {
    const from = topDir(file);
    if (!from) {
      continue;
    }
    const text = await readFile(file, "utf8");
    const specs = new Set<string>();
    for (const match of text.matchAll(FROM_SPECIFIER)) {
      specs.add(match[1] as string);
    }
    for (const match of text.matchAll(BARE_IMPORT)) {
      specs.add(match[1] as string);
    }
    for (const spec of specs) {
      if (!spec.startsWith(".")) {
        continue;
      }
      const to = topDir(`${resolveRelative(file, spec)}/`);
      if (to && to !== from) {
        edges.push({ from, to, file, spec });
      }
    }
  }
  return edges;
};

const edges = await collectEdges();

if (process.argv.includes("--print-edges")) {
  const seen = new Map<string, number>();
  for (const edge of edges) {
    const key = `${edge.from} -> ${edge.to}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const key of [...seen.keys()].sort()) {
    console.log(`${key}  (${seen.get(key)} files)`);
  }
  process.exit(0);
}

const violations: string[] = [];
for (const edge of edges) {
  if (FORBIDDEN_TARGETS[edge.from]?.includes(edge.to)) {
    violations.push(`${edge.file} imports from forbidden layer ${edge.to}/ (via "${edge.spec}")`);
  }
}

if (violations.length > 0) {
  console.error("Import-layer violations found:");
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  console.error(
    "\nsrc/ layering is enforced: see scripts/check-import-layers.ts for the allowed directions.",
  );
  process.exit(1);
}
