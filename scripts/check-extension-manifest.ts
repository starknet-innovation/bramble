/**
 * Enforces browser-extension manifest boundaries before building or packaging.
 */
import { readFile } from "node:fs/promises";

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

const extensionRoot = "apps/extension";
const publicRoot = `${extensionRoot}/public`;
const sourceRoot = `${extensionRoot}/src`;
const manifest = await readJson(`${publicRoot}/manifest.json`);
const packageJson = await readJson("package.json");

const expectedBackgroundServiceWorker = "background/index.js";
// Remote NFT artwork may live on any HTTPS host. The side panel enforces the
// privacy boundary instead: it creates no remote <img> for an unsolicited NFT
// until the user explicitly opens it, while watched NFTs are already solicited.
// Scripts and objects remain packaged-only.
const expectedExtensionCsp =
  "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; img-src 'self' data: https:; frame-src 'self';";
// CSP for the sandboxed animation renderer (sandbox/render.html). It runs an
// NFT's untrusted on-chain data:text/html in an isolated security principal:
// `allow-scripts` (no `allow-same-origin`) lets the canvas animate but grants no
// privileged extension-API or parent-DOM access, and `default-src 'none'` (no
// connect-src) blocks all network egress so an opened collectible can never
// phone home. `frame-src blob:` permits only the renderer-created nested
// sandbox document; it does not grant a remote network destination.
const expectedSandboxCsp =
  "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-src blob:; base-uri 'none'; form-action 'none'";
const expectedSandboxPage = "sandbox/render.html";
const expectedMatches = ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"];
const expectedHostPermissions = [
  // Wallet-owned RPC and STRK20 gateway: the preferred path for every signed
  // or broadcast request. Private upstream URLs and paymaster credentials
  // remain deployment-only configuration.
  "https://wallet.nodes.starknet.org/*",
  // Starknet Foundation public RPC nodes, kept as the keyless transport
  // fallback for when the gateway itself is unreachable. Same operator the
  // gateway forwards to, so a gateway outage does not take the wallet offline.
  "https://mainnet.nodes.starknet.org/*",
  "https://sepolia.nodes.starknet.org/*",
  // Keyless availability fallback when a Foundation node is unreachable.
  "https://api.cartridge.gg/*",
  "https://api.coingecko.com/*",
  // Read-only indexed activity and complete token-holdings snapshots. This
  // never participates in signing or transaction submission.
  "https://starkscan.co/*",
  // AVNU swap aggregator (quotes + build calldata) for the in-wallet swap
  // flow, per network. Responses are validated in packages/features/transactions/src/avnu.ts and
  // policy-checked in apps/extension/src/background/swap-ops.ts before anything is signed.
  "https://starknet.api.avnu.fi/*",
  "https://sepolia.api.avnu.fi/*",
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
    "sandbox",
    "side_panel",
    "version",
    "web_accessible_resources",
  ])
) {
  failures.push("manifest top-level capabilities must stay explicit");
}

// `alarms` schedules background transaction reconciliation. An MV3 service
// worker is terminated when idle, so a timer is not a schedule; alarms are the
// only way to keep verifying a submitted transaction through to L1 finality
// after the side panel closes. It grants no data access and shows no Chrome
// permission warning.
if (!hasOnly(manifest["permissions"], ["alarms", "sidePanel", "storage"])) {
  failures.push("manifest permissions must stay alarms, sidePanel, and storage only");
}

const hostPermissions = manifest["host_permissions"];
if (!Array.isArray(hostPermissions) || new Set(hostPermissions).size !== hostPermissions.length) {
  failures.push("manifest host_permissions must not contain duplicates");
}
if (!hasOnly(hostPermissions, expectedHostPermissions)) {
  failures.push("manifest host_permissions must stay pinned to reviewed service endpoints");
}

const contentSecurityPolicy = hasOnlyKeys(manifest["content_security_policy"], [
  "extension_pages",
  "sandbox",
])
  ? manifest["content_security_policy"]
  : null;
if (!contentSecurityPolicy || contentSecurityPolicy["extension_pages"] !== expectedExtensionCsp) {
  failures.push(
    "manifest CSP must allow only packaged scripts, Krusty WASM, and self/data/HTTPS images",
  );
}
if (!contentSecurityPolicy || contentSecurityPolicy["sandbox"] !== expectedSandboxCsp) {
  failures.push("manifest sandbox CSP must isolate the renderer and block network egress");
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
await requireFile(`${sourceRoot}/${backgroundPath.replace(/\.js$/, ".ts")}`);

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
await requireFile(`${publicRoot}/${sidePanelPath}`);
if (sidePanelPath) {
  const sidePanelHtml = await readFile(`${publicRoot}/${sidePanelPath}`, "utf8");
  const scriptTags = sidePanelHtml.match(/<script\b/gi) ?? [];
  if (
    scriptTags.length !== 1 ||
    !sidePanelHtml.includes('<script type="module" src="./sidepanel/index.js"></script>') ||
    /\son[a-z]+\s*=|javascript:/i.test(sidePanelHtml)
  ) {
    failures.push("side panel HTML must load only the packaged side panel module");
  }
}

const sandbox = hasOnlyKeys(manifest["sandbox"], ["pages"]) ? manifest["sandbox"] : null;
if (!sandbox || !hasOnly(sandbox["pages"], [expectedSandboxPage])) {
  failures.push("manifest sandbox pages must stay pinned to the collectible renderer");
}
await requireFile(`${publicRoot}/${expectedSandboxPage}`);
await requireFile(`${sourceRoot}/${expectedSandboxPage.replace(/\.html$/, ".ts")}`);
if (await Bun.file(`${publicRoot}/${expectedSandboxPage}`).exists()) {
  const sandboxHtml = await readFile(`${publicRoot}/${expectedSandboxPage}`, "utf8");
  const sandboxScriptTags = sandboxHtml.match(/<script\b/gi) ?? [];
  if (
    sandboxScriptTags.length !== 1 ||
    !sandboxHtml.includes('<script type="module" src="./render.js"></script>') ||
    /\son[a-z]+\s*=|javascript:/i.test(sandboxHtml)
  ) {
    failures.push("sandbox HTML must load only the packaged renderer module");
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
  await requireFile(`${sourceRoot}/${contentPath?.toString().replace(/\.js$/, ".ts")}`);
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
  await requireFile(`${sourceRoot}/${providerPath?.toString().replace(/\.js$/, ".ts")}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}
