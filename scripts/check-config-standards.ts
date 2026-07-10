/**
 * Enforces pinned repository configuration, CI, and artifact policy.
 */
import { readFile } from "node:fs/promises";
import {
  DEPENDENCY_FIELDS,
  EXPECTED_CONTRIBUTING_RULES,
  EXPECTED_CONTRIBUTING_SECTIONS,
  EXPECTED_DEPENDENCIES,
  EXPECTED_DEV_DEPENDENCIES,
  EXPECTED_GITIGNORE_ENTRIES,
  EXPECTED_PACKAGE_MANAGER,
  EXPECTED_PACKAGE_SCRIPTS,
  EXPECTED_README_SECTIONS,
  PINNED_RUNTIME_FILES,
  REQUIRED_BIOME_COMPLEXITY_RULES,
  REQUIRED_BIOME_LINTER_DOMAINS,
  REQUIRED_BIOME_NURSERY_RULES,
  REQUIRED_COMPILER_OPTIONS,
  SEMVER,
} from "./config-standards-policy";
import { EXPECTED_RUNTIME_FILES } from "./extension-runtime-files";

const failures: string[] = [];

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasStringList = (value: unknown, expected: readonly string[]): boolean =>
  Array.isArray(value) &&
  value.length === expected.length &&
  expected.every((item, index) => value[index] === item);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

const packageJson = await readJson("package.json");
const biomeJson = await readJson("biome.json");
const gitignore = await readFile(".gitignore", "utf8");
const manifestJson = await readJson("public/manifest.json");
const readme = await readFile("README.md", "utf8");
const contributing = await readFile("CONTRIBUTING.md", "utf8");
const tsconfigJson = await readJson("tsconfig.json");
const buildScript = await readFile("scripts/build-extension.ts", "utf8");
const ciWorkflow = await readFile(".github/workflows/ci.yml", "utf8");
const packageScript = await readFile("scripts/package-extension.ts", "utf8");
const vendorKrustyScript = await readFile("scripts/vendor-krusty.ts", "utf8");

if (
  !hasOnlyKeys(packageJson, [
    "dependencies",
    "devDependencies",
    "name",
    "packageManager",
    "private",
    "scripts",
    "type",
    "version",
  ])
) {
  failures.push("package.json top-level keys must stay explicit");
}

if (!hasOnlyKeys(tsconfigJson, ["compilerOptions", "include"])) {
  failures.push("tsconfig.json top-level keys must stay explicit");
}

if (!hasOnlyKeys(biomeJson, ["$schema", "files", "formatter", "javascript", "linter", "vcs"])) {
  failures.push("biome.json top-level keys must stay explicit");
}

if (
  typeof packageJson["version"] !== "string" ||
  typeof manifestJson["version"] !== "string" ||
  packageJson["version"] !== manifestJson["version"]
) {
  failures.push("package.json and public/manifest.json versions must match");
}

if (
  typeof packageJson["version"] !== "string" ||
  typeof manifestJson["version"] !== "string" ||
  !SEMVER.test(packageJson["version"]) ||
  !SEMVER.test(manifestJson["version"])
) {
  failures.push("package.json and public/manifest.json versions must use x.y.z");
}

if (packageJson["packageManager"] !== EXPECTED_PACKAGE_MANAGER) {
  failures.push(`package.json packageManager must stay ${EXPECTED_PACKAGE_MANAGER}`);
}

if (
  packageJson["name"] !== "mc-wallet" ||
  packageJson["private"] !== true ||
  packageJson["type"] !== "module"
) {
  failures.push("package.json must stay private ESM mc-wallet package metadata");
}

if (biomeJson["$schema"] !== "https://biomejs.dev/schemas/2.5.2/schema.json") {
  failures.push("biome.json schema must stay pinned to 2.5.2");
}

const biomeVcs = isRecord(biomeJson["vcs"]) ? biomeJson["vcs"] : null;
if (!biomeVcs || !hasOnlyKeys(biomeVcs, ["enabled"]) || biomeVcs["enabled"] !== false) {
  failures.push("biome.json VCS integration must stay disabled");
}

const biomeFiles = isRecord(biomeJson["files"]) ? biomeJson["files"] : null;
if (
  !biomeFiles ||
  !hasOnlyKeys(biomeFiles, ["includes"]) ||
  !hasStringList(biomeFiles?.["includes"], [
    "**",
    "!.claude",
    "!bun.lock",
    "!dist",
    "!node_modules",
    "!playwright-report",
    "!test-results",
    "!vendor",
  ])
) {
  failures.push("biome.json must check the repository while excluding generated files");
}

const biomeFormatter = isRecord(biomeJson["formatter"]) ? biomeJson["formatter"] : null;
if (
  !biomeFormatter ||
  !hasOnlyKeys(biomeFormatter, ["enabled", "indentStyle", "indentWidth", "lineWidth"]) ||
  biomeFormatter?.["enabled"] !== true ||
  biomeFormatter["indentStyle"] !== "space" ||
  biomeFormatter["indentWidth"] !== 2 ||
  biomeFormatter["lineWidth"] !== 100
) {
  failures.push("biome.json formatter settings must stay explicit");
}

const biomeJavascript = isRecord(biomeJson["javascript"]) ? biomeJson["javascript"] : null;
const biomeJavascriptFormatter =
  biomeJavascript && isRecord(biomeJavascript["formatter"]) ? biomeJavascript["formatter"] : null;
if (
  !biomeJavascript ||
  !hasOnlyKeys(biomeJavascript, ["formatter"]) ||
  !biomeJavascriptFormatter ||
  !hasOnlyKeys(biomeJavascriptFormatter, ["quoteStyle", "semicolons", "trailingCommas"]) ||
  biomeJavascriptFormatter?.["quoteStyle"] !== "double" ||
  biomeJavascriptFormatter["semicolons"] !== "always" ||
  biomeJavascriptFormatter["trailingCommas"] !== "all"
) {
  failures.push("biome.json JavaScript formatter settings must stay explicit");
}

const biomeLinter = isRecord(biomeJson["linter"]) ? biomeJson["linter"] : null;
const biomeDomains =
  biomeLinter && isRecord(biomeLinter["domains"]) ? biomeLinter["domains"] : null;
const biomeRules = biomeLinter && isRecord(biomeLinter["rules"]) ? biomeLinter["rules"] : null;
const biomeComplexity =
  biomeRules && isRecord(biomeRules["complexity"]) ? biomeRules["complexity"] : null;
const biomeNursery = biomeRules && isRecord(biomeRules["nursery"]) ? biomeRules["nursery"] : null;
const biomeStyle = biomeRules && isRecord(biomeRules["style"]) ? biomeRules["style"] : null;
const biomeSuspicious =
  biomeRules && isRecord(biomeRules["suspicious"]) ? biomeRules["suspicious"] : null;
const noParameterAssign =
  biomeStyle && isRecord(biomeStyle["noParameterAssign"]) ? biomeStyle["noParameterAssign"] : null;
const noParameterAssignOptions =
  noParameterAssign && isRecord(noParameterAssign["options"]) ? noParameterAssign["options"] : null;
if (
  !biomeLinter ||
  !hasOnlyKeys(biomeLinter, ["domains", "enabled", "rules"]) ||
  !biomeDomains ||
  !hasOnlyKeys(biomeDomains, Object.keys(REQUIRED_BIOME_LINTER_DOMAINS)) ||
  !biomeRules ||
  !hasOnlyKeys(biomeRules, ["complexity", "nursery", "preset", "style", "suspicious"]) ||
  !biomeComplexity ||
  !hasOnlyKeys(biomeComplexity, Object.keys(REQUIRED_BIOME_COMPLEXITY_RULES)) ||
  !biomeNursery ||
  !hasOnlyKeys(biomeNursery, Object.keys(REQUIRED_BIOME_NURSERY_RULES)) ||
  !biomeStyle ||
  !hasOnlyKeys(biomeStyle, ["noNonNullAssertion", "noParameterAssign", "useImportType"]) ||
  !noParameterAssign ||
  !hasOnlyKeys(noParameterAssign, ["level", "options"]) ||
  !noParameterAssignOptions ||
  !hasOnlyKeys(noParameterAssignOptions, ["propertyAssignment"]) ||
  !biomeSuspicious ||
  !hasOnlyKeys(biomeSuspicious, ["noExplicitAny"]) ||
  biomeLinter?.["enabled"] !== true ||
  biomeRules?.["preset"] !== "recommended" ||
  biomeStyle?.["noNonNullAssertion"] !== "error" ||
  biomeStyle["useImportType"] !== "error" ||
  noParameterAssign?.["level"] !== "error" ||
  noParameterAssignOptions?.["propertyAssignment"] !== "deny" ||
  biomeSuspicious?.["noExplicitAny"] !== "error"
) {
  failures.push("biome.json linter rules must stay strict");
}

for (const [domain, expected] of Object.entries(REQUIRED_BIOME_LINTER_DOMAINS)) {
  if (biomeDomains?.[domain] !== expected) {
    failures.push(`biome.json linter domain ${domain} must stay ${expected}`);
  }
}

for (const [rule, expected] of Object.entries(REQUIRED_BIOME_COMPLEXITY_RULES)) {
  if (biomeComplexity?.[rule] !== expected) {
    failures.push(`biome.json complexity rule ${rule} must stay ${expected}`);
  }
}

for (const [rule, expected] of Object.entries(REQUIRED_BIOME_NURSERY_RULES)) {
  if (biomeNursery?.[rule] !== expected) {
    failures.push(`biome.json nursery rule ${rule} must stay ${expected}`);
  }
}

const packageScripts = isRecord(packageJson["scripts"]) ? packageJson["scripts"] : null;
if (
  !packageScripts ||
  Reflect.ownKeys(packageScripts).length !== Object.keys(EXPECTED_PACKAGE_SCRIPTS).length
) {
  failures.push("package.json scripts must stay explicit");
} else {
  for (const [script, expected] of Object.entries(EXPECTED_PACKAGE_SCRIPTS)) {
    if (packageScripts[script] !== expected) {
      failures.push(`package.json scripts.${script} must stay ${expected}`);
    }
  }
}

const compilerOptions = isRecord(tsconfigJson["compilerOptions"])
  ? tsconfigJson["compilerOptions"]
  : null;
if (!compilerOptions) {
  failures.push("tsconfig.json must declare strict compilerOptions");
} else {
  if (
    !hasOnlyKeys(compilerOptions, [
      ...Object.keys(REQUIRED_COMPILER_OPTIONS),
      "lib",
      "module",
      "moduleResolution",
      "target",
      "types",
    ])
  ) {
    failures.push("tsconfig.json compilerOptions keys must stay explicit");
  }
  for (const [option, expected] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
    if (compilerOptions[option] !== expected) {
      failures.push(`tsconfig.json compilerOptions.${option} must stay ${String(expected)}`);
    }
  }
  if (
    compilerOptions["module"] !== "ESNext" ||
    compilerOptions["moduleResolution"] !== "Bundler" ||
    compilerOptions["target"] !== "ES2022"
  ) {
    failures.push("tsconfig.json compilerOptions module settings must stay browser-ready");
  }
  if (!hasStringList(compilerOptions["lib"], ["ES2022", "DOM", "DOM.Iterable"])) {
    failures.push("tsconfig.json compilerOptions.lib must stay browser-ready");
  }
  if (!hasStringList(compilerOptions["types"], ["bun-types"])) {
    failures.push("tsconfig.json compilerOptions.types must stay Bun-only");
  }
}
if (!hasStringList(tsconfigJson["include"], ["scripts/**/*.ts", "src/**/*.ts", "tests/**/*.ts"])) {
  failures.push("tsconfig.json include must cover scripts, src, and tests");
}

const gitignoreLines = gitignore.split("\n").map((line) => line.trim());
for (const entry of EXPECTED_GITIGNORE_ENTRIES) {
  if (!gitignoreLines.includes(entry)) {
    failures.push(`.gitignore must ignore generated ${entry}`);
  }
}

for (const section of EXPECTED_README_SECTIONS) {
  if (!readme.includes(section)) {
    failures.push(`README.md must document ${section.slice(3).toLowerCase()}`);
  }
}

for (const section of EXPECTED_CONTRIBUTING_SECTIONS) {
  if (!contributing.includes(section)) {
    failures.push(`CONTRIBUTING.md must document ${section.slice(3).toLowerCase()}`);
  }
}

for (const rule of EXPECTED_CONTRIBUTING_RULES) {
  if (!contributing.includes(rule)) {
    failures.push(`CONTRIBUTING.md must keep rule: ${rule}`);
  }
}

for (const field of DEPENDENCY_FIELDS) {
  if (Object.hasOwn(packageJson, field)) {
    failures.push(`package.json must not declare ${field}`);
  }
}

const devDependencies = isRecord(packageJson["devDependencies"])
  ? packageJson["devDependencies"]
  : null;
const dependencies = isRecord(packageJson["dependencies"]) ? packageJson["dependencies"] : null;
if (
  !dependencies ||
  Reflect.ownKeys(dependencies).length !== Object.keys(EXPECTED_DEPENDENCIES).length
) {
  failures.push("package.json dependencies must stay explicit");
} else {
  for (const [name, version] of Object.entries(EXPECTED_DEPENDENCIES)) {
    if (dependencies[name] !== version) {
      failures.push(`package.json dependency ${name} must stay ${version}`);
    }
  }
}

if (
  !devDependencies ||
  Reflect.ownKeys(devDependencies).length !== Object.keys(EXPECTED_DEV_DEPENDENCIES).length
) {
  failures.push("package.json devDependencies must stay explicit");
} else {
  for (const [name, version] of Object.entries(EXPECTED_DEV_DEPENDENCIES)) {
    if (devDependencies[name] !== version) {
      failures.push(`package.json devDependency ${name} must stay ${version}`);
    }
  }
}

if (!/const KRUSTY_KMS_REVISION = "[0-9a-f]{40}";/.test(vendorKrustyScript)) {
  failures.push("scripts/vendor-krusty.ts must pin a Krusty KMS commit");
}

if (vendorKrustyScript.includes('"pull"')) {
  failures.push("scripts/vendor-krusty.ts must not follow a moving Krusty KMS branch");
}

if (EXPECTED_RUNTIME_FILES.join("\n") !== PINNED_RUNTIME_FILES.join("\n")) {
  failures.push("scripts/extension-runtime-files.ts must keep the pinned runtime file set");
}

const ciCommands = [
  "cargo install wasm-pack --locked --version 0.13.1",
  "bun install --frozen-lockfile",
  "bun run test:e2e:install",
  "bun run check:files",
  "bun run vendor:krusty",
  "bun run vendor:multisig",
  "bun run check",
  "bun run check:coverage",
  "bun run build",
  "bun run test:e2e",
  "bun run package:extension",
];
const ciLines = ciWorkflow.split("\n").map((line) => line.trim());
let previousCiCommand = -1;
for (const command of ciCommands) {
  const index = ciLines.indexOf(`- run: ${command}`);
  if (index === -1 || index <= previousCiCommand) {
    failures.push(`.github/workflows/ci.yml must run ${command} in order`);
  }
  previousCiCommand = index;
}

const packageCommandIndex = ciLines.indexOf("- run: bun run package:extension");
const uploadActionIndex = ciLines.findIndex((line) =>
  /^- uses: actions\/upload-artifact@[0-9a-f]{40}/.test(line),
);
const uploadNameIndex = ciLines.indexOf("name: mc-wallet-extension");
const uploadZipIndex = ciLines.indexOf("artifacts/*.zip");
const uploadChecksumIndex = ciLines.indexOf("artifacts/*.zip.sha256");
const uploadRequiredIndex = ciLines.indexOf("if-no-files-found: error");
if (
  uploadActionIndex <= packageCommandIndex ||
  uploadNameIndex <= uploadActionIndex ||
  uploadZipIndex <= uploadNameIndex ||
  uploadChecksumIndex <= uploadZipIndex ||
  uploadRequiredIndex <= uploadChecksumIndex
) {
  failures.push(".github/workflows/ci.yml must upload the release zip and SHA-256 checksum");
}

const buildExtensionCheck = buildScript.indexOf('await run(["bun", "run", "check:extension"]);');
const buildKrustyCheck = buildScript.indexOf('await run(["bun", "run", "check:krusty"]);');
const buildDistClear = buildScript.indexOf("await rm(outdir");
if (
  buildExtensionCheck === -1 ||
  buildKrustyCheck === -1 ||
  buildDistClear === -1 ||
  buildExtensionCheck > buildDistClear ||
  buildKrustyCheck > buildDistClear
) {
  failures.push("scripts/build-extension.ts must check manifest and Krusty before building");
}

const packageTouch = packageScript.indexOf('await run(["touch", "-t", reproducibleZipTime');
const packageZip = packageScript.indexOf('await run(["zip", "-X", "-q", zipPath');
const packageRuntimeImport = packageScript.indexOf(
  'import { EXPECTED_RUNTIME_FILES } from "./extension-runtime-files";',
);
const packageRuntimeCheck = packageScript.indexOf(
  'files.join("\\n") !== EXPECTED_RUNTIME_FILES.join("\\n")',
);
const packageRuntimeFailure = packageScript.indexOf("unexpected packaged files");
if (
  packageRuntimeImport === -1 ||
  packageRuntimeCheck === -1 ||
  packageRuntimeFailure === -1 ||
  packageRuntimeImport > packageRuntimeCheck ||
  packageRuntimeCheck > packageZip ||
  packageRuntimeFailure < packageRuntimeCheck
) {
  failures.push("scripts/package-extension.ts must package only the pinned runtime files");
}

const packageZipNamePrefix = packageScript.indexOf("const zipName = `mc-wallet-");
const packageZipNameVersion = packageScript.indexOf('manifest["version"]', packageZipNamePrefix);
const packageZipNameSuffix = packageScript.indexOf(".zip`;", packageZipNameVersion);
const packageZipPath = packageScript.indexOf("const zipPath = resolve(artifactDir, zipName);");
if (
  packageZipNamePrefix === -1 ||
  packageZipNameVersion === -1 ||
  packageZipNameSuffix === -1 ||
  packageZipPath === -1 ||
  packageZipNamePrefix > packageZipNameVersion ||
  packageZipNameVersion > packageZipNameSuffix ||
  packageZipNameSuffix > packageZipPath ||
  packageZipPath > packageZip
) {
  failures.push("scripts/package-extension.ts must name release zips from the manifest version");
}

if (packageTouch === -1 || packageZip === -1 || packageTouch > packageZip) {
  failures.push("scripts/package-extension.ts must normalize mtimes before zipping");
}

const packageDigest = packageScript.indexOf('createHash("sha256")');
const packageChecksumWrite = packageScript.indexOf("await writeFile(");
const packageChecksumSuffix = packageScript.indexOf(".sha256");
if (
  packageZip === -1 ||
  packageDigest === -1 ||
  packageChecksumWrite === -1 ||
  packageChecksumSuffix === -1 ||
  packageZip > packageDigest ||
  packageDigest > packageChecksumWrite ||
  packageChecksumWrite > packageChecksumSuffix
) {
  failures.push("scripts/package-extension.ts must write a SHA-256 checksum after zipping");
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}
