/**
 * Enforces private-workspace ownership, declared edges, exports, and an acyclic
 * deny-by-default dependency graph without adding a build-orchestration tool.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { PINNED_RUNTIME_FILES } from "./config-standards-policy";
import { isOutsideRoot, sourceImports } from "./workspace-architecture-imports";
import {
  DEVELOPMENT_SOURCE_FILES,
  EXCLUDED_DIRECTORIES,
  EXTENSION_SURFACE_EDGES,
  NON_LITERAL_MODULE_LOADS,
  STRUCTURED_SOURCE_ROOTS,
} from "./workspace-architecture-policy";

type Manifest = {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, string>>;
  readonly imports?: unknown;
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
    "@mc-wallet/pq-transport",
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
    "@mc-wallet/core",
    "@mc-wallet/ledger-protocol",
    "@mc-wallet/testkit",
    "@mc-wallet/wallet-model",
  ],
  "@mc-wallet/ledger-protocol": [
    "@mc-wallet/core",
    "@mc-wallet/testkit",
    "@mc-wallet/wallet-model",
  ],
  "@mc-wallet/multisig": [
    "@mc-wallet/core",
    "@mc-wallet/starknet",
    "@mc-wallet/store",
    "@mc-wallet/wallet-model",
  ],
  "@mc-wallet/permissions": ["@mc-wallet/core", "@mc-wallet/store"],
  "@mc-wallet/pq-transport": ["@mc-wallet/core", "@mc-wallet/wallet-model"],
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
    "@mc-wallet/starknet",
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

const SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);

const failures: string[] = [];

for (const [root, allowedFiles] of Object.entries(STRUCTURED_SOURCE_ROOTS)) {
  const allowed = new Set(allowedFiles);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)) && !allowed.has(entry.name)) {
      failures.push(`${root}/${entry.name} must live in a named capability directory`);
    }
  }
}

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
  if (workspace.manifest.imports !== undefined) {
    failures.push(`${workspace.root}/package.json may not hide dependencies behind import aliases`);
  }
  if (workspace.root !== "." && (await Bun.file(join(workspace.root, "bun.lock")).exists())) {
    failures.push(`${workspace.root}/bun.lock duplicates the root workspace lockfile`);
  }
  const productionDependencies = workspace.manifest.dependencies ?? {};
  const developmentDependencies = workspace.manifest.devDependencies ?? {};
  for (const dependency of Object.keys(productionDependencies)) {
    if (Object.hasOwn(developmentDependencies, dependency)) {
      failures.push(`${workspace.name} declares ${dependency} in dependencies and devDependencies`);
    }
  }
  for (const [dependency, version] of dependencyEntries(workspace.manifest)) {
    if (!isExactVersion(version)) {
      failures.push(`${workspace.name} dependency ${dependency} must use an exact version`);
    }
    if (dependency.startsWith("@mc-wallet/") && version !== "workspace:*") {
      failures.push(`${workspace.name} dependency ${dependency} must use workspace:*`);
    }
    if (dependency.startsWith("@mc-wallet/")) {
      if (!byName.has(dependency)) {
        failures.push(`${workspace.name} declares unknown workspace ${dependency}`);
      }
      if (dependency === workspace.name) {
        failures.push(`${workspace.name} may not depend on itself`);
      }
      if (!ALLOWED_EDGES[workspace.name]?.includes(dependency)) {
        failures.push(`${workspace.name} may not declare dependency ${dependency}`);
      }
    }
  }
  for (const [key, target] of Object.entries(workspace.manifest.exports ?? {})) {
    const exportSegments = key === "." ? [] : key.startsWith("./") ? key.slice(2).split("/") : [""];
    if (
      key.includes("*") ||
      exportSegments.some((segment) => !segment || segment === "." || segment === "..")
    ) {
      failures.push(`${workspace.name} export ${key} must be explicit`);
    }
    const sourceRoot = resolve(workspace.root, "src");
    const exportTarget = resolve(workspace.root, target);
    if (
      !target.startsWith("./src/") ||
      isOutsideRoot(sourceRoot, exportTarget) ||
      !(await Bun.file(exportTarget).exists())
    ) {
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
    } else if (entry.isSymbolicLink()) {
      failures.push(`${path} may not be a symbolic link inside a workspace`);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(path))) {
      files.push(path);
    }
  }
  return files;
};

const graph = new Map(
  workspaces.map((workspace) => [
    workspace.name,
    new Set(
      dependencyEntries(workspace.manifest)
        .map(([dependency]) => dependency)
        .filter((dependency) => byName.has(dependency)),
    ),
  ]),
);
const extensionRoot = resolve("apps/extension/src");
const seenNonLiteralAllowances = new Set<string>();
const externalPackageName = (specifier: string): string | null => {
  const [first, second] = specifier.split("/");
  if (!first || (first.startsWith("@") && !second)) {
    return null;
  }
  return first.startsWith("@") ? `${first}/${second}` : first;
};

const isRuntimeSource = (workspace: Workspace, file: string): boolean => {
  if (workspace.name === "mc-wallet" || workspace.name === "@mc-wallet/ui-lab") {
    return false;
  }
  const repositoryRelative = relative(resolve("."), resolve(file)).split(sep).join("/");
  const segments = repositoryRelative.split("/");
  if (
    DEVELOPMENT_SOURCE_FILES.has(repositoryRelative) ||
    segments.includes("test") ||
    segments.includes("tests") ||
    segments.includes("__tests__") ||
    /\.(?:spec|test)\.[^.]+$/.test(file)
  ) {
    return false;
  }
  const roots = workspace.name === "@mc-wallet/terminal" ? ["api", "shared", "src"] : ["src"];
  return roots.some((root) => !isOutsideRoot(resolve(workspace.root, root), file));
};

for (const workspace of workspaces) {
  const edges = graph.get(workspace.name) ?? new Set<string>();
  for (const file of await walkTypeScript(workspace.root, workspace.root === ".")) {
    const source = await readFile(file, "utf8");
    const imports = sourceImports(file, source);
    const repositoryRelative = relative(resolve("."), resolve(file)).split(sep).join("/");
    const allowedNonLiteralLoads = NON_LITERAL_MODULE_LOADS.get(repositoryRelative) ?? 0;
    if (NON_LITERAL_MODULE_LOADS.has(repositoryRelative)) {
      seenNonLiteralAllowances.add(repositoryRelative);
    }
    if (imports.nonLiteralModuleLoads !== allowedNonLiteralLoads) {
      failures.push(
        `${file} contains ${imports.nonLiteralModuleLoads} non-literal module loads; expected ${allowedNonLiteralLoads}`,
      );
    }
    const productionSource = !isOutsideRoot(resolve(workspace.root, "src"), file);
    const runtimeSource = isRuntimeSource(workspace, file);
    const extensionRelative = relative(extensionRoot, resolve(file));
    const extensionSurface = isOutsideRoot(extensionRoot, file)
      ? undefined
      : extensionRelative.split(sep)[0];
    const surfaceEdges = extensionSurface ? EXTENSION_SURFACE_EDGES[extensionSurface] : undefined;
    for (const specifier of imports.specifiers) {
      if (specifier.startsWith("/")) {
        const runtimeFile = specifier.slice(1);
        if (
          workspace.name !== "@mc-wallet/extension" ||
          !PINNED_RUNTIME_FILES.includes(runtimeFile as (typeof PINNED_RUNTIME_FILES)[number])
        ) {
          failures.push(`${file} imports unpinned extension runtime file ${specifier}`);
        }
        continue;
      }
      if (specifier.startsWith(".") || isAbsolute(specifier)) {
        const target = isAbsolute(specifier)
          ? resolve(specifier)
          : resolve(dirname(file), specifier);
        if (isOutsideRoot(workspace.root, target)) {
          failures.push(`${file} imports across its workspace boundary via ${specifier}`);
        }
        if (
          surfaceEdges &&
          extensionSurface &&
          isOutsideRoot(resolve(extensionRoot, extensionSurface), target)
        ) {
          failures.push(`${file} imports outside its extension surface via ${specifier}`);
        }
        continue;
      }
      if (!specifier.startsWith("@mc-wallet/")) {
        if (surfaceEdges) {
          failures.push(
            `${file} may not import external module ${specifier} from the ${extensionSurface} surface`,
          );
        }
        if (specifier.startsWith("node:") || specifier.startsWith("bun:")) {
          continue;
        }
        const dependency = externalPackageName(specifier);
        if (dependency === null) {
          failures.push(`${file} imports invalid external module specifier ${specifier}`);
          continue;
        }
        const productionVersion = workspace.manifest.dependencies?.[dependency];
        const developmentVersion = workspace.manifest.devDependencies?.[dependency];
        if (!productionVersion && !developmentVersion) {
          failures.push(
            `${workspace.name} must directly declare external dependency ${dependency}`,
          );
        } else if (runtimeSource && !productionVersion) {
          failures.push(
            `${file} may not import development-only dependency ${dependency} at runtime`,
          );
        }
        continue;
      }
      const [scope, packageSegment, ...subpath] = specifier.split("/");
      const targetName = `${scope}/${packageSegment}`;
      const target = byName.get(targetName);
      if (!target) {
        failures.push(`${file} imports unknown workspace ${targetName}`);
        continue;
      }
      if (surfaceEdges && !surfaceEdges.includes(targetName)) {
        failures.push(`${file} may not import ${targetName} from the ${extensionSurface} surface`);
      }
      if (
        specifier === "@mc-wallet/wallet-ui/lab" &&
        productionSource &&
        workspace.name !== "@mc-wallet/ui-lab"
      ) {
        failures.push(`${file} may not import the development-only Wallet UI lab surface`);
      }
      const exportKey = subpath.length === 0 ? "." : `./${subpath.join("/")}`;
      if (!Object.hasOwn(target.manifest.exports ?? {}, exportKey)) {
        failures.push(`${file} imports undeclared ${targetName} export ${exportKey}`);
      }
      if (targetName === workspace.name) {
        continue;
      }
      if (targetName === "@mc-wallet/testkit" && productionSource) {
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
    }
  }
}

for (const path of NON_LITERAL_MODULE_LOADS.keys()) {
  if (!seenNonLiteralAllowances.has(path)) {
    failures.push(`non-literal module-load allowance references missing source ${path}`);
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
for (const [name, allowed] of Object.entries(ALLOWED_EDGES)) {
  if (new Set(allowed).size !== allowed.length || allowed.includes(name)) {
    failures.push(`architecture policy for ${name} must contain unique non-self edges`);
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
