/**
 * Enforces private-workspace ownership, declared edges, exports, and an acyclic
 * deny-by-default dependency graph without adding a build-orchestration tool.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

type Manifest = {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, string>>;
  readonly name?: string;
  readonly private?: boolean;
  readonly type?: string;
};

type Workspace = {
  readonly manifest: Manifest;
  readonly name: string;
  readonly root: string;
};

const ALLOWED_EDGES: Readonly<Record<string, readonly string[]>> = {
  "@mc-wallet/extension": [
    "@mc-wallet/core",
    "@mc-wallet/kms-krusty",
    "@mc-wallet/ledger-browser",
    "@mc-wallet/ledger-protocol",
    "@mc-wallet/multisig",
    "@mc-wallet/permissions",
    "@mc-wallet/portfolio",
    "@mc-wallet/privacy",
    "@mc-wallet/settings",
    "@mc-wallet/starknet",
    "@mc-wallet/store",
    "@mc-wallet/transactions",
    "@mc-wallet/ui-kit",
    "@mc-wallet/vault",
    "@mc-wallet/wallet-model",
    "@mc-wallet/wallet-protocol",
    "@mc-wallet/wallet-ui",
  ],
  "@mc-wallet/core": [],
  "@mc-wallet/kms-krusty": ["@mc-wallet/core", "@mc-wallet/vault", "@mc-wallet/wallet-model"],
  "@mc-wallet/ledger-browser": [
    "@mc-wallet/ledger-protocol",
    "@mc-wallet/testkit",
    "@mc-wallet/wallet-model",
  ],
  "@mc-wallet/ledger-protocol": ["@mc-wallet/testkit", "@mc-wallet/wallet-model"],
  "@mc-wallet/multisig": [
    "@mc-wallet/core",
    "@mc-wallet/starknet",
    "@mc-wallet/store",
    "@mc-wallet/wallet-model",
  ],
  "@mc-wallet/permissions": ["@mc-wallet/core", "@mc-wallet/store"],
  "@mc-wallet/privacy": [
    "@mc-wallet/core",
    "@mc-wallet/starknet",
    "@mc-wallet/store",
    "@mc-wallet/wallet-model",
    "@mc-wallet/wallet-protocol",
  ],
  "@mc-wallet/portfolio": ["@mc-wallet/core", "@mc-wallet/store", "@mc-wallet/wallet-model"],
  "@mc-wallet/starknet": [
    "@mc-wallet/core",
    "@mc-wallet/wallet-model",
    "@mc-wallet/wallet-protocol",
  ],
  "@mc-wallet/settings": [
    "@mc-wallet/core",
    "@mc-wallet/portfolio",
    "@mc-wallet/privacy",
    "@mc-wallet/store",
    "@mc-wallet/wallet-model",
  ],
  "@mc-wallet/store": ["@mc-wallet/core"],
  "@mc-wallet/testkit": ["@mc-wallet/settings", "@mc-wallet/wallet-model"],
  "@mc-wallet/transactions": [
    "@mc-wallet/core",
    "@mc-wallet/starknet",
    "@mc-wallet/store",
    "@mc-wallet/wallet-model",
  ],
  "@mc-wallet/ui-kit": ["@mc-wallet/core", "@mc-wallet/wallet-model"],
  "@mc-wallet/vault": [
    "@mc-wallet/core",
    "@mc-wallet/store",
    "@mc-wallet/testkit",
    "@mc-wallet/wallet-model",
  ],
  "@mc-wallet/terminal": [],
  "@mc-wallet/ui-lab": [
    "@mc-wallet/core",
    "@mc-wallet/ledger-protocol",
    "@mc-wallet/multisig",
    "@mc-wallet/privacy",
    "@mc-wallet/settings",
    "@mc-wallet/starknet",
    "@mc-wallet/transactions",
    "@mc-wallet/ui-kit",
    "@mc-wallet/wallet-ui",
    "@mc-wallet/wallet-model",
  ],
  "@mc-wallet/wallet-model": ["@mc-wallet/core"],
  "@mc-wallet/wallet-protocol": ["@mc-wallet/core", "@mc-wallet/wallet-model"],
  "@mc-wallet/wallet-ui": [
    "@mc-wallet/core",
    "@mc-wallet/ledger-protocol",
    "@mc-wallet/multisig",
    "@mc-wallet/portfolio",
    "@mc-wallet/privacy",
    "@mc-wallet/settings",
    "@mc-wallet/store",
    "@mc-wallet/starknet",
    "@mc-wallet/testkit",
    "@mc-wallet/transactions",
    "@mc-wallet/ui-kit",
    "@mc-wallet/wallet-model",
    "@mc-wallet/wallet-protocol",
  ],
  "mc-wallet": [
    "@mc-wallet/core",
    "@mc-wallet/kms-krusty",
    "@mc-wallet/ledger-browser",
    "@mc-wallet/ledger-protocol",
    "@mc-wallet/multisig",
    "@mc-wallet/permissions",
    "@mc-wallet/privacy",
    "@mc-wallet/portfolio",
    "@mc-wallet/starknet",
    "@mc-wallet/store",
    "@mc-wallet/settings",
    "@mc-wallet/testkit",
    "@mc-wallet/transactions",
    "@mc-wallet/ui-kit",
    "@mc-wallet/vault",
    "@mc-wallet/wallet-ui",
    "@mc-wallet/wallet-model",
    "@mc-wallet/wallet-protocol",
  ],
};

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  "artifacts",
  "dist",
  "node_modules",
  "output",
  "playwright-report",
  "target",
  "test-results",
  "vendor",
]);

const EXTENSION_SURFACE_EDGES: Readonly<Record<string, readonly string[]>> = {
  content: ["@mc-wallet/wallet-protocol"],
  "ledger-grant": ["@mc-wallet/ledger-browser", "@mc-wallet/ledger-protocol", "@mc-wallet/ui-kit"],
  provider: ["@mc-wallet/wallet-protocol"],
  sandbox: [],
  sidepanel: ["@mc-wallet/ledger-browser", "@mc-wallet/wallet-ui"],
};

const IMPORT_SPECIFIER =
  /(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;

const failures: string[] = [];

const readManifest = async (path: string): Promise<Manifest> =>
  JSON.parse(await readFile(path, "utf8")) as Manifest;

const childDirectories = async (path: string): Promise<string[]> =>
  (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(path, entry.name));

const workspaceRoots = async (): Promise<string[]> => {
  const roots = [".", ...(await childDirectories("apps"))];
  for (const group of await childDirectories("packages")) {
    roots.push(...(await childDirectories(group)));
  }
  return roots;
};

const workspaces: Workspace[] = [];
for (const root of await workspaceRoots()) {
  const manifest = await readManifest(join(root, "package.json"));
  if (typeof manifest.name !== "string") {
    failures.push(`${root}/package.json must declare a package name`);
    continue;
  }
  workspaces.push({ manifest, name: manifest.name, root });
}

const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
if (byName.size !== workspaces.length) {
  failures.push("workspace package names must be unique");
}

const dependencyEntries = (manifest: Manifest): Array<readonly [string, string]> => [
  ...Object.entries(manifest.dependencies ?? {}),
  ...Object.entries(manifest.devDependencies ?? {}),
];

const isExactVersion = (version: string): boolean =>
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) || version === "workspace:*";

for (const workspace of workspaces) {
  if (workspace.manifest.private !== true || workspace.manifest.type !== "module") {
    failures.push(`${workspace.root}/package.json must be private ESM package metadata`);
  }
  if (workspace.root !== "." && (await Bun.file(join(workspace.root, "bun.lock")).exists())) {
    failures.push(`${workspace.root}/bun.lock duplicates the root workspace lockfile`);
  }
  for (const [dependency, version] of dependencyEntries(workspace.manifest)) {
    if (!isExactVersion(version)) {
      failures.push(`${workspace.name} dependency ${dependency} must use an exact version`);
    }
    if (dependency.startsWith("@mc-wallet/") && version !== "workspace:*") {
      failures.push(`${workspace.name} dependency ${dependency} must use workspace:*`);
    }
  }
  for (const [key, target] of Object.entries(workspace.manifest.exports ?? {})) {
    if (key.includes("*")) {
      failures.push(`${workspace.name} export ${key} must be explicit`);
    }
    if (!target.startsWith("./src/") || !(await Bun.file(join(workspace.root, target)).exists())) {
      failures.push(`${workspace.name} export ${key} must resolve to an existing source file`);
    }
  }
}

const walkTypeScript = async (root: string, isRepositoryRoot = false): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (
      EXCLUDED_DIRECTORIES.has(entry.name) ||
      (isRepositoryRoot && (entry.name === "apps" || entry.name === "packages"))
    ) {
      continue;
    }
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkTypeScript(path)));
    } else if (
      entry.isFile() &&
      (path.endsWith(".js") || path.endsWith(".ts") || path.endsWith(".tsx"))
    ) {
      files.push(path);
    }
  }
  return files;
};

const graph = new Map<string, Set<string>>();
for (const workspace of workspaces) {
  const edges = new Set<string>();
  graph.set(workspace.name, edges);
  for (const file of await walkTypeScript(workspace.root, workspace.root === ".")) {
    const source = await readFile(file, "utf8");
    const extensionRelative = relative(resolve("apps/extension/src"), resolve(file));
    const extensionSurface = extensionRelative.split("/")[0];
    const surfaceEdges = EXTENSION_SURFACE_EDGES[extensionSurface ?? ""];
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1] ?? match[2];
      if (specifier?.startsWith(".")) {
        const target = resolve(dirname(file), specifier);
        if (relative(resolve(workspace.root), target).startsWith("..")) {
          failures.push(`${file} imports across its workspace boundary via ${specifier}`);
        }
        if (
          surfaceEdges &&
          relative(resolve("apps/extension/src", extensionSurface ?? ""), target).startsWith("..")
        ) {
          failures.push(`${file} imports outside its extension surface via ${specifier}`);
        }
        continue;
      }
      if (!specifier?.startsWith("@mc-wallet/")) {
        continue;
      }
      const [scope, packageSegment, ...subpath] = specifier.split("/");
      const targetName = `${scope}/${packageSegment}`;
      const target = byName.get(targetName);
      if (!target) {
        failures.push(`${file} imports unknown workspace ${targetName}`);
        continue;
      }
      if (targetName === workspace.name) {
        continue;
      }
      if (surfaceEdges && !surfaceEdges.includes(targetName)) {
        failures.push(`${file} may not import ${targetName} from the ${extensionSurface} surface`);
      }
      if (
        targetName === "@mc-wallet/testkit" &&
        relative(resolve(workspace.root), resolve(file)).startsWith("src/")
      ) {
        failures.push(`${file} may not import the testkit from production source`);
      }
      edges.add(targetName);
      if (!ALLOWED_EDGES[workspace.name]?.includes(targetName)) {
        failures.push(`${workspace.name} may not depend on ${targetName}`);
      }
      const declared = {
        ...workspace.manifest.devDependencies,
        ...workspace.manifest.dependencies,
      }[targetName];
      if (declared !== "workspace:*") {
        failures.push(`${workspace.name} must declare ${targetName} as workspace:*`);
      }
      const exportKey = subpath.length === 0 ? "." : `./${subpath.join("/")}`;
      if (!Object.hasOwn(target.manifest.exports ?? {}, exportKey)) {
        failures.push(`${file} imports undeclared ${targetName} export ${exportKey}`);
      }
    }
  }
}

const visiting = new Set<string>();
const visited = new Set<string>();
const visit = (name: string, path: readonly string[]): void => {
  if (visiting.has(name)) {
    failures.push(`workspace dependency cycle: ${[...path, name].join(" -> ")}`);
    return;
  }
  if (visited.has(name)) {
    return;
  }
  visiting.add(name);
  for (const target of graph.get(name) ?? []) {
    visit(target, [...path, name]);
  }
  visiting.delete(name);
  visited.add(name);
};
for (const name of graph.keys()) {
  visit(name, []);
}

for (const name of Object.keys(ALLOWED_EDGES)) {
  if (!byName.has(name)) {
    failures.push(`architecture policy names missing workspace ${name}`);
  }
}
for (const workspace of workspaces) {
  if (!Object.hasOwn(ALLOWED_EDGES, workspace.name)) {
    failures.push(`architecture policy must explicitly classify ${workspace.name}`);
  }
}

if (failures.length > 0) {
  for (const failure of [...new Set(failures)].sort()) {
    console.error(failure);
  }
  process.exit(1);
}
