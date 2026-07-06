/**
 * Enforces browser-extension manifest boundaries before building or packaging.
 */
import { readFile } from "node:fs/promises";

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

const manifest = await readJson("public/manifest.json");
const packageJson = await readJson("package.json");

const expectedExtensionCsp = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';";
const expectedMatches = ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"];
const failures: string[] = [];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> =>
  isRecord(value) &&
  Reflect.ownKeys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));

const hasOnly = (value: unknown, expected: readonly string[]): boolean =>
  Array.isArray(value) &&
  value.length === expected.length &&
  expected.every((entry) => value.includes(entry));

const requireFile = async (path: string): Promise<void> => {
  if (!(await Bun.file(path).exists())) {
    failures.push(`${path} is missing`);
  }
};

if (manifest.manifest_version !== 3) {
  failures.push("manifest must use MV3");
}

if (manifest.version !== packageJson.version) {
  failures.push("manifest version must match package.json");
}

if (
  !hasOnlyKeys(manifest, [
    "action",
    "background",
    "content_security_policy",
    "content_scripts",
    "description",
    "host_permissions",
    "manifest_version",
    "name",
    "permissions",
    "version",
    "web_accessible_resources",
  ])
) {
  failures.push("manifest top-level capabilities must stay explicit");
}

if (!hasOnly(manifest.permissions, ["storage"])) {
  failures.push("manifest permissions must stay storage-only");
}

if (!hasOnly(manifest.host_permissions, [])) {
  failures.push("manifest host_permissions must stay empty");
}

const contentSecurityPolicy = hasOnlyKeys(manifest.content_security_policy, ["extension_pages"])
  ? manifest.content_security_policy
  : null;
if (!contentSecurityPolicy || contentSecurityPolicy.extension_pages !== expectedExtensionCsp) {
  failures.push("manifest CSP must allow only packaged scripts and Krusty WASM");
}

const background = hasOnlyKeys(manifest.background, ["service_worker", "type"])
  ? manifest.background
  : null;
if (background?.type !== "module") {
  failures.push("manifest background worker must stay module-only");
}
const backgroundPath =
  typeof background?.service_worker === "string" ? background.service_worker : "";
await requireFile(`src/${backgroundPath.replace(/\.js$/, ".ts")}`);

const action = hasOnlyKeys(manifest.action, ["default_popup"]) ? manifest.action : null;
if (!action) {
  failures.push("manifest action must expose only the popup");
}
const popupPath = typeof action?.default_popup === "string" ? action.default_popup : "";
await requireFile(`public/${popupPath}`);
if (popupPath) {
  const popupHtml = await readFile(`public/${popupPath}`, "utf8");
  const scriptTags = popupHtml.match(/<script\b/gi) ?? [];
  if (
    scriptTags.length !== 1 ||
    !popupHtml.includes('<script type="module" src="./popup/index.js"></script>') ||
    /\son[a-z]+\s*=|javascript:/i.test(popupHtml)
  ) {
    failures.push("popup HTML must load only the packaged popup module");
  }
}

const contentScripts = manifest.content_scripts;
if (!Array.isArray(contentScripts) || contentScripts.length !== 1) {
  failures.push("manifest must expose one content script");
} else {
  const [script] = contentScripts;
  const contentScript = hasOnlyKeys(script, ["js", "matches", "run_at"]) ? script : null;
  if (
    !contentScript ||
    !hasOnly(contentScript.matches, expectedMatches) ||
    contentScript.run_at !== "document_start"
  ) {
    failures.push("content script matches or run_at changed");
  }
  const [contentPath] = Array.isArray(contentScript?.js) ? contentScript.js : [];
  await requireFile(`src/${contentPath?.toString().replace(/\.js$/, ".ts")}`);
}

const resources = manifest.web_accessible_resources;
if (!Array.isArray(resources) || resources.length !== 1) {
  failures.push("manifest must expose one web-accessible resource group");
} else {
  const [resource] = resources;
  const resourceGroup = hasOnlyKeys(resource, ["matches", "resources"]) ? resource : null;
  if (!resourceGroup || !hasOnly(resourceGroup.matches, expectedMatches)) {
    failures.push("web-accessible resource matches changed");
  }
  const [providerPath] = Array.isArray(resourceGroup?.resources) ? resourceGroup.resources : [];
  await requireFile(`src/${providerPath?.toString().replace(/\.js$/, ".ts")}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}
