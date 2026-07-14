/**
 * Enforces browser-extension manifest boundaries before building or packaging.
 */
import { readFile } from "node:fs/promises";

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

const manifest = await readJson("public/manifest.json");
const packageJson = await readJson("package.json");

const expectedBackgroundServiceWorker = "background/index.js";
const expectedExtensionCsp = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';";
const expectedMatches = ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"];
const expectedHostPermissions = [
  "https://api.cartridge.gg/*",
  "https://api.coingecko.com/*",
  // Maintained web3 phishing feed (issue #34): the default source for the live
  // malicious-origin blocklist. Configurable per deployment via the feed's
  // `source` option; pinned here so the manifest stays an explicit allowlist.
  "https://metamask.github.io/*",
  "http://127.0.0.1:5050/*",
  "http://localhost:5050/*",
];
const expectedActionTitle = "Open MC Wallet";
const expectedSidePanel = "sidepanel.html";
const expectedProviderResource = "provider/inpage.js";
const expectedContentScript = "content/index.js";
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
  expected.every((entry, index) => value[index] === entry);

const requireFile = async (path: string): Promise<void> => {
  if (!(await Bun.file(path).exists())) {
    failures.push(`${path} is missing`);
  }
};

if (manifest["manifest_version"] !== 3) {
  failures.push("manifest must use MV3");
}

if (manifest["version"] !== packageJson["version"]) {
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
    "side_panel",
    "version",
    "web_accessible_resources",
  ])
) {
  failures.push("manifest top-level capabilities must stay explicit");
}

if (!hasOnly(manifest["permissions"], ["sidePanel", "storage"])) {
  failures.push("manifest permissions must stay sidePanel and storage only");
}

if (!hasOnly(manifest["host_permissions"], expectedHostPermissions)) {
  failures.push("manifest host_permissions must stay pinned to Starknet RPC endpoints");
}

const contentSecurityPolicy = hasOnlyKeys(manifest["content_security_policy"], ["extension_pages"])
  ? manifest["content_security_policy"]
  : null;
if (!contentSecurityPolicy || contentSecurityPolicy["extension_pages"] !== expectedExtensionCsp) {
  failures.push("manifest CSP must allow only packaged scripts and Krusty WASM");
}

const background = hasOnlyKeys(manifest["background"], ["service_worker", "type"])
  ? manifest["background"]
  : null;
if (background?.["type"] !== "module") {
  failures.push("manifest background worker must stay module-only");
}
const backgroundPath =
  typeof background?.["service_worker"] === "string" ? background["service_worker"] : "";
if (backgroundPath !== expectedBackgroundServiceWorker) {
  failures.push("manifest background worker path must stay pinned");
}
await requireFile(`src/${backgroundPath.replace(/\.js$/, ".ts")}`);

const action = hasOnlyKeys(manifest["action"], ["default_title"]) ? manifest["action"] : null;
if (action?.["default_title"] !== expectedActionTitle) {
  failures.push("manifest action must open the wallet side panel");
}

const sidePanel = hasOnlyKeys(manifest["side_panel"], ["default_path"])
  ? manifest["side_panel"]
  : null;
const sidePanelPath =
  typeof sidePanel?.["default_path"] === "string" ? sidePanel["default_path"] : "";
if (sidePanelPath !== expectedSidePanel) {
  failures.push("manifest side panel path must stay pinned");
}
await requireFile(`public/${sidePanelPath}`);
if (sidePanelPath) {
  const sidePanelHtml = await readFile(`public/${sidePanelPath}`, "utf8");
  const scriptTags = sidePanelHtml.match(/<script\b/gi) ?? [];
  if (
    scriptTags.length !== 1 ||
    !sidePanelHtml.includes('<script type="module" src="./sidepanel/index.js"></script>') ||
    /\son[a-z]+\s*=|javascript:/i.test(sidePanelHtml)
  ) {
    failures.push("side panel HTML must load only the packaged side panel module");
  }
}

const contentScripts = manifest["content_scripts"];
if (!Array.isArray(contentScripts) || contentScripts.length !== 1) {
  failures.push("manifest must expose one content script");
} else {
  const [script] = contentScripts;
  const contentScript = hasOnlyKeys(script, ["js", "matches", "run_at"]) ? script : null;
  if (
    !contentScript ||
    !hasOnly(contentScript["matches"], expectedMatches) ||
    contentScript["run_at"] !== "document_start"
  ) {
    failures.push("content script matches or run_at changed");
  }
  if (!hasOnly(contentScript?.["js"], [expectedContentScript])) {
    failures.push("content script path must stay pinned");
  }
  const [contentPath] = Array.isArray(contentScript?.["js"]) ? contentScript["js"] : [];
  await requireFile(`src/${contentPath?.toString().replace(/\.js$/, ".ts")}`);
}

const resources = manifest["web_accessible_resources"];
if (!Array.isArray(resources) || resources.length !== 1) {
  failures.push("manifest must expose one web-accessible resource group");
} else {
  const [resource] = resources;
  const resourceGroup = hasOnlyKeys(resource, ["matches", "resources"]) ? resource : null;
  if (!resourceGroup || !hasOnly(resourceGroup["matches"], expectedMatches)) {
    failures.push("web-accessible resource matches changed");
  }
  if (!hasOnly(resourceGroup?.["resources"], [expectedProviderResource])) {
    failures.push("web-accessible provider path must stay pinned");
  }
  const [providerPath] = Array.isArray(resourceGroup?.["resources"])
    ? resourceGroup["resources"]
    : [];
  await requireFile(`src/${providerPath?.toString().replace(/\.js$/, ".ts")}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}
