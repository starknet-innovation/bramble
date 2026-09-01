/**
 * Enforces browser-extension manifest boundaries before building or packaging.
 *
 * The policy below is pure and exported so the packaged-page rules can be
 * exercised directly; the manifest, filesystem, and process-exit effects run
 * only when this file is the entry point.
 */
import { readFile } from "node:fs/promises";
import { EXPECTED_RUNTIME_FILES } from "./extension-runtime-files";

/**
 * One HTML page shipped inside the extension package and the single packaged
 * module it is allowed to execute, written as it appears in the page's own
 * `src` attribute.
 */
export type PackagedPage = {
  readonly module: string;
  readonly path: string;
};

/**
 * Every HTML page in the packaged extension, each paired with its one packaged
 * entry module. A page in `dist/` runs in the extension origin with the wallet's
 * full privileges however it is opened, so this list — not the manifest, which
 * names only two of them — is the declaration of the shipped page surface. It is
 * cross-checked against the packaged file set in `extension-runtime-files.ts`,
 * so a new page cannot ship without being declared and integrity-checked here.
 */
export const PACKAGED_PAGES: readonly PackagedPage[] = [
  // The side panel, declared by the manifest as `side_panel.default_path`.
  { module: "./sidepanel/index.js", path: "sidepanel.html" },
  // Opened in a tab on first run by
  // apps/extension/src/background/onboarding/onboarding-surface.ts.
  { module: "./sidepanel/index.js", path: "onboarding.html" },
  // Installed as the toolbar popup at runtime by
  // apps/extension/src/background/approvals/approval-surface.ts when the user
  // prefers popup approvals. The manifest deliberately declares no
  // `default_popup`, so this page has no manifest declaration to check against.
  { module: "./sidepanel/index.js", path: "popup.html" },
  // Opened in a tab by packages/platform/ledger-browser/src/grant-window.ts to
  // collect the WebHID/WebUSB device grant a side panel cannot request.
  { module: "./ledger-grant/index.js", path: "ledger-grant.html" },
  // The collectible renderer, declared by the manifest as its only sandbox page.
  { module: "./render.js", path: "sandbox/render.html" },
];

/**
 * Resolves a page's `src` attribute to its path inside the package, so the
 * declared module can be compared against the packaged file set.
 */
export const packagedModulePath = (page: PackagedPage): string => {
  const separator = page.path.lastIndexOf("/");
  const directory = separator === -1 ? "" : page.path.slice(0, separator + 1);
  return `${directory}${page.module.replace(/^\.\//, "")}`;
};

/**
 * Reports every packaged HTML page that is not declared in `PACKAGED_PAGES`, or
 * whose declared entry module is not itself packaged. Pure: the packaged file
 * set is supplied by the caller. Failures mean a page or module would ship
 * outside the reviewed surface.
 */
export const packagedPageDeclarationFailures = (
  runtimeFiles: readonly string[],
): readonly string[] => {
  const failures: string[] = [];
  const declared = new Set(PACKAGED_PAGES.map((page) => page.path));
  for (const file of runtimeFiles) {
    if (file.endsWith(".html") && !declared.has(file)) {
      failures.push(`${file} is packaged but not declared in PACKAGED_PAGES`);
    }
  }
  const packaged = new Set(runtimeFiles);
  for (const page of PACKAGED_PAGES) {
    if (!packaged.has(page.path)) {
      failures.push(`${page.path} is declared but not packaged`);
    }
    const module = packagedModulePath(page);
    if (!packaged.has(module)) {
      failures.push(`${page.path} must load a packaged module, not ${module}`);
    }
  }
  return failures;
};

/**
 * Reports every manifest-named page that is not declared in `PACKAGED_PAGES`.
 * The manifest names only the side panel and the sandbox renderer; both must
 * also appear in the page table, so the manifest cannot point at a page the
 * integrity rules below never see. Pure: the caller supplies the manifest values.
 */
export const manifestPageDeclarationFailures = (
  manifestPages: readonly string[],
): readonly string[] => {
  const declared = new Set(PACKAGED_PAGES.map((page) => page.path));
  return manifestPages
    .filter((page) => !declared.has(page))
    .map((page) => `${page} is named by the manifest but not declared in PACKAGED_PAGES`);
};

// The named character references that can reconstruct a `javascript:` URI once a
// browser decodes an attribute value: the colon itself, and the characters a URL
// parser strips before resolving the scheme.
const NAMED_REFERENCES: Readonly<Record<string, string>> = {
  NewLine: "\n",
  Tab: "\t",
  amp: "&",
  apos: "'",
  colon: ":",
  gt: ">",
  lt: "<",
  quot: '"',
  semi: ";",
  sol: "/",
};

/**
 * Decodes the HTML character references a browser resolves inside an attribute
 * value, so `&#106;avascript:` and `javascript&colon;` are compared in the form
 * that would actually execute. One pass, like the tokenizer: a reference that
 * decodes to `&` is never decoded again. Unknown or out-of-range references are
 * left verbatim, which can only make the caller's rules stricter, never laxer.
 */
export const decodeCharacterReferences = (html: string): string =>
  html.replace(
    /&(#[Xx][0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);?/g,
    (reference, body: string) => {
      if (body.startsWith("#")) {
        const digits = body.slice(1);
        const code = digits.startsWith("x") || digits.startsWith("X") ? digits.slice(1) : digits;
        const value = Number.parseInt(code, digits === code ? 10 : 16);
        return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
          ? String.fromCodePoint(value)
          : reference;
      }
      return NAMED_REFERENCES[body] ?? reference;
    },
  );

/**
 * Reports every integrity violation in one packaged page's HTML: any script tag
 * other than the single declared module, an inline event-handler attribute, or a
 * `javascript:` URI. Pure so the same rule covers every page; an empty result is
 * the only outcome the manifest gate may treat as verified.
 *
 * The handler rule matches the HTML tokenizer rather than the tidy spelling: a
 * solidus or a closing quote separates attributes exactly as whitespace does
 * (`<body class="x"/onload="…">` runs), so all three are accepted separators.
 * The URI rule runs over decoded references with whitespace removed, so neither
 * `&#106;avascript:` nor `java&#10;script:` reads as anything but the scheme a
 * browser would resolve. Both rules are deliberately over-broad — a false
 * positive fails the gate closed and is fixed by rewriting the page.
 */
export const packagedPageFailures = (page: PackagedPage, html: string): readonly string[] => {
  const failures: string[] = [];
  const scriptTags = html.match(/<script\b/gi) ?? [];
  if (
    scriptTags.length !== 1 ||
    !html.includes(`<script type="module" src="${page.module}"></script>`)
  ) {
    failures.push(`${page.path} must load only the packaged module ${page.module}`);
  }
  const decoded = decodeCharacterReferences(html);
  // A URL parser drops whitespace before resolving a scheme. Only the URI rule
  // reads this stripped copy; the handler rule keeps `decoded`, where whitespace
  // still separates one attribute from the next.
  const urls = decoded.replace(/\s/g, "");
  if (/["'\s/]on[a-z]+\s*=/i.test(decoded) || /javascript:/i.test(urls)) {
    failures.push(`${page.path} must not carry inline event handlers or javascript: URIs`);
  }
  return failures;
};

if (import.meta.main) {
  const readJson = async (path: string): Promise<Record<string, unknown>> =>
    JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

  // The extension app owns the manifest, the packaged pages, and the entry
  // modules every pin below resolves against; the workspace packages it builds
  // from are never named here.
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
    // flow, per network. Responses are validated in
    // packages/features/transactions/src/swap/avnu.ts and policy-checked in
    // apps/extension/src/background/transactions/swap-ops.ts before anything is
    // signed.
    "https://starknet.api.avnu.fi/*",
    "https://sepolia.api.avnu.fi/*",
    // Maintained web3 phishing feed (issue #34): the default source for the live
    // malicious-origin blocklist. Configurable per deployment via the feed's
    // `source` option; pinned here so the manifest stays an explicit allowlist.
    "https://metamask.github.io/*",
    "http://127.0.0.1:5050/*",
    "http://localhost:5050/*",
  ];
  // Chrome grants none of these until a user saves a custom HTTP service from
  // Settings. The UI requests only that endpoint's exact origin; the broad
  // declaration is the MV3 ceiling needed to support arbitrary HTTPS hosts.
  const expectedOptionalHostPermissions = [
    "https://*/*",
    "http://127.0.0.1/*",
    "http://localhost/*",
  ];
  const expectedActionTitle = "Open Bramble";
  const expectedIcons = {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png",
  } as const;
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
      "icons",
      "manifest_version",
      "name",
      "optional_host_permissions",
      "permissions",
      "sandbox",
      "side_panel",
      "version",
      "web_accessible_resources",
    ])
  ) {
    failures.push("manifest top-level capabilities must stay explicit");
  }

  // `alarms` schedules background transaction reconciliation and the unlock
  // session's expiry deadline. An MV3 service worker is terminated when idle, so
  // a timer is not a schedule; alarms are the only way to keep verifying a
  // submitted transaction through to L1 finality after the side panel closes,
  // and the only way to destroy an idle unlock at its deadline rather than on
  // whatever read happens next. It grants no data access and shows no Chrome
  // permission warning.
  if (!hasOnly(manifest["permissions"], ["alarms", "sidePanel", "storage"])) {
    failures.push("manifest permissions must stay alarms, sidePanel, and storage only");
  }

  const icons = hasOnlyKeys(manifest["icons"], ["16", "32", "48", "128"])
    ? manifest["icons"]
    : null;
  for (const [size, path] of Object.entries(expectedIcons)) {
    if (icons?.[size] !== path) failures.push(`manifest ${size}px icon must stay ${path}`);
    await requireFile(`${publicRoot}/${path}`);
  }

  const hostPermissions = manifest["host_permissions"];
  if (!Array.isArray(hostPermissions) || new Set(hostPermissions).size !== hostPermissions.length) {
    failures.push("manifest host_permissions must not contain duplicates");
  }
  if (!hasOnly(hostPermissions, expectedHostPermissions)) {
    failures.push("manifest host_permissions must stay pinned to reviewed service endpoints");
  }
  const optionalHostPermissions = manifest["optional_host_permissions"];
  if (
    !Array.isArray(optionalHostPermissions) ||
    new Set(optionalHostPermissions).size !== optionalHostPermissions.length
  ) {
    failures.push("manifest optional_host_permissions must not contain duplicates");
  }
  if (!hasOnly(optionalHostPermissions, expectedOptionalHostPermissions)) {
    failures.push("manifest optional hosts must stay HTTPS-or-loopback and user-granted");
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

  const sandbox = hasOnlyKeys(manifest["sandbox"], ["pages"]) ? manifest["sandbox"] : null;
  if (!sandbox || !hasOnly(sandbox["pages"], [expectedSandboxPage])) {
    failures.push("manifest sandbox pages must stay pinned to the collectible renderer");
  }
  await requireFile(`${sourceRoot}/${expectedSandboxPage.replace(/\.html$/, ".ts")}`);

  // Every packaged page — manifest-declared or opened at runtime — is checked
  // against the same integrity rule, and the declaration is derived from the
  // packaged file set so a new page cannot slip through unchecked. The manifest's
  // own page names are cross-checked against that table (rather than assumed
  // equal to the pins above), so a manifest that ever named a different page
  // would fail here instead of pointing at an unverified page.
  const sandboxPages = Array.isArray(sandbox?.["pages"])
    ? sandbox["pages"].filter((page): page is string => typeof page === "string")
    : [];
  failures.push(
    ...manifestPageDeclarationFailures(
      [sidePanelPath, ...sandboxPages].filter((page) => page !== ""),
    ),
  );
  failures.push(...packagedPageDeclarationFailures(EXPECTED_RUNTIME_FILES));
  for (const page of PACKAGED_PAGES) {
    const source = `${publicRoot}/${page.path}`;
    await requireFile(source);
    if (await Bun.file(source).exists()) {
      failures.push(...packagedPageFailures(page, await readFile(source, "utf8")));
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
}
