/**
 * Enforces repository file-size and TypeScript doc-comment standards.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { actionReferences, isPinnedActionReference, WORKFLOW_DIR } from "./workflow-inventory";

const MAX_LINES = 500;
const EXCLUDED = new Set([
  ".claude",
  ".dev-profile",
  ".git",
  ".impeccable",
  ".playwright-cli",
  "artifacts",
  "bun.lock",
  "Cargo.lock",
  "dist",
  "dist-firefox",
  "node_modules",
  "output",
  "playwright-report",
  "target",
  "test-results",
  "vendor",
]);
/**
 * Directories skipped by full path rather than by name. `apps/` now holds the
 * shipped extension next to two projects this gate has never covered (the
 * hosted terminal and the Storybook UI lab), so excluding the whole tree by
 * name — as this list did while `src/` was the extension root — would silently
 * disable every `apps/extension/src` rule below, including the secret-material
 * and browser-global boundaries. Skipping by path keeps the extension scanned.
 */
// Mobile build outputs, all git-ignored: the XcodeGen project, UniFFI bindings and XCFramework,
// Gradle state, and the Android native libraries. `target` (Cargo) is excluded by name above.
const EXCLUDED_PATHS = new Set([
  "apps/terminal",
  "apps/ui-lab",
  // Pinned lint tools (SwiftLint, ktlint, detekt jars), downloaded by mobile/scripts/lint-tools.sh.
  "mobile/.tools",
  "mobile/android/.gradle",
  "mobile/android/app/build",
  "mobile/android/app/src/main/jniLibs",
  "mobile/android/build",
  "mobile/ios/Bramble.xcodeproj",
  "mobile/ios/Generated",
  "mobile/ios/build",
]);
const BINARY_EXTENSIONS = [".jpg", ".otf", ".png", ".wasm", ".webp", ".woff2", ".zip"] as const;
const BROWSER_GLOBAL_FILES = new Set([
  "apps/extension/src/background/index.ts",
  "apps/extension/src/extension-api.ts",
  "apps/extension/src/content/index.ts",
  "apps/extension/src/ledger-grant/dom.ts",
  "apps/extension/src/ledger-grant/index.ts",
  "apps/extension/src/provider/inpage.ts",
  "apps/extension/src/sandbox/render.ts",
  "packages/presentation/wallet-ui/src/sidepanel/shared/dom.ts",
  "packages/presentation/wallet-ui/src/sidepanel/app/rendering/focus-memo.ts",
  "packages/presentation/wallet-ui/src/sidepanel/app/sync/lifecycle.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/activity-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/app/start.ts",
  "packages/platform/ledger-browser/src/grant-window.ts",
  "packages/platform/ledger-browser/src/transport.ts",
  "packages/presentation/wallet-ui/src/sidepanel/app/rendering/scene-renderer.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/settings/settings-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/send/transfer-ui.ts",
  "apps/extension/src/browser-storage.ts",
]);
const ENCRYPTED_STORE_WIRING_FILES = new Set([
  "apps/extension/src/background/index.ts",
  "packages/platform/vault/src/encrypted-store.ts",
]);
const RANDOM_UUID_FILES = new Set([
  "apps/extension/src/background/analytics/gateway-analytics.ts",
  "apps/extension/src/background/approvals/approvals.ts",
  "apps/extension/src/provider/inpage.ts",
  "packages/platform/ledger-browser/src/grant-window.ts",
]);
const RAW_ERROR_BOUNDARY_FILES = new Set([
  "apps/extension/src/background/index.ts",
  "apps/extension/src/content/index.ts",
]);

import { SECRET_MATERIAL_FILES, SECRET_MATERIAL_PATTERN } from "./file-standards-policy";

const SUPPRESSION_MARKERS = [
  "@ts-" + "expect-error",
  "@ts-" + "ignore",
  "biome-" + "ignore",
  "eslint-" + "disable",
];
// C0 control bytes are illegal in TypeScript source: a raw NUL or other stray
// control byte reclassifies the file as binary, so grep/ripgrep and every
// grep-based guard silently skip it and the bytes are invisible in editors and
// review. Tab (9), newline (10) and carriage return (13) are the only permitted
// controls. Scanned by code point rather than a regex so this rule does not
// itself embed the control characters it forbids.
const hasControlByte = (text: string): boolean => {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) {
      return true;
    }
  }
  return false;
};
const DYNAMIC_CODE_PATTERN =
  /\b(?:eval|importScripts)\s*\(|\bnew Function\b|\b(?:setTimeout|setInterval)\s*\(\s*["']|import\s*\(\s*["']https?:\/\//;
const HTML_SINK_FILES = new Set([
  "packages/presentation/wallet-ui/src/sidepanel/shared/dom.ts",
  "packages/presentation/wallet-ui/src/sidepanel/app/rendering/focus-memo.ts",
  "packages/presentation/wallet-ui/src/sidepanel/app/start.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/tokens-ui.ts",
  // AVNU catalog rows, written into the tokens screen's list region as the
  // fetched list arrives: symbol and name pass through escapeHtml, the address
  // through tokenGlyph, and the actions through the ui-kit button helper — the
  // same profile as the detected-token rows in tokens-ui.ts.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/token-catalog-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/send/transfer-ui.ts",
  // Send-screen rendering split out of transfer-ui.ts; the review panels it
  // writes come from the same escaped markup helpers that file used.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/send/transfer-render.ts",
  // Swap screen dynamic regions (chips, picker rows, receipts): every
  // interpolation passes through escapeHtml/tokenGlyph — audited 2026-07.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/swap/swap-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/swap/swap-picker.ts",
  // Shell replacement extracted from the sidepanel entrypoint; it receives
  // fully escaped production templates and owns no dynamic template content.
  "packages/presentation/wallet-ui/src/sidepanel/app/rendering/scene-renderer.ts",
  // Collectible animation renderer: document.write of the untrusted on-chain
  // data:text/html, confined by the manifest sandbox page's isolated security
  // principal and egress-blocking CSP (never executed in a privileged page) —
  // audited 2026-07.
  "apps/extension/src/sandbox/render.ts",
]);
const HTML_SINK_PATTERN =
  /\b(?:createContextualFragment|document\.write|innerHTML|insertAdjacentHTML|outerHTML|srcdoc)\b/;
const VAULT_SERVICE_WIRING_FILES = new Set([
  "apps/extension/src/background/index.ts",
  "packages/platform/vault/src/schema/store-migration.ts",
  "packages/platform/vault/src/service/service.ts",
]);

const failures: string[] = [];

const isProductionSource = (file: string): boolean =>
  file.startsWith("apps/extension/src/") || /^packages\/[^/]+\/[^/]+\/src\//.test(file);

// A module every source rule applies to: any TypeScript file, and any
// JavaScript file on a production source path. Shipped `.js` modules (the
// ledger-browser transport) sit outside `tsc`, so this gate is the only
// check that holds them to the security rules (Sherlock 235). Other `.js`
// files (website, configuration) are not wallet source and keep only the
// generic rules.
const isSourceModule = (file: string): boolean =>
  file.endsWith(".ts") || (file.endsWith(".js") && isProductionSource(file));

const hasExportDoc = (lines: readonly string[], index: number): boolean => {
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const line = lines[previous]?.trim() ?? "";
    if (line === "") {
      continue;
    }
    return line === "*/" || (line.startsWith("/**") && line.endsWith("*/"));
  }
  return false;
};

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (EXCLUDED.has(entry.name) || EXCLUDED_PATHS.has(path)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (
      entry.isFile() &&
      !BINARY_EXTENSIONS.some((extension) => entry.name.endsWith(extension))
    ) {
      files.push(path);
    }
  }

  return files;
};

for (const file of await walk(".")) {
  const text = await readFile(file, "utf8");
  const lines = text.split("\n");
  const lineCount = text.length === 0 ? 0 : lines.length;

  if (lineCount > MAX_LINES) {
    failures.push(`${file} has ${lineCount} lines; max is ${MAX_LINES}`);
  }

  if (isSourceModule(file) && !text.trimStart().startsWith("/**")) {
    failures.push(`${file} must start with a doc comment`);
  }

  if (isSourceModule(file) && hasControlByte(text)) {
    failures.push(`${file} must not contain raw control bytes (use a \\u escape)`);
  }

  // A production `.js` module's API is typed and documented in its sibling
  // declaration file, which this rule checks as `.ts`; the module itself must
  // have one.
  if (
    isProductionSource(file) &&
    file.endsWith(".js") &&
    !existsSync(`${file.slice(0, -3)}.d.ts`)
  ) {
    failures.push(`${file} must declare and document its API in a sibling .d.ts`);
  }

  if (isProductionSource(file) && file.endsWith(".ts")) {
    lines.forEach((line, index) => {
      if (
        /^export (?:\{|class|const|function|interface|type)\b/.test(line) &&
        !hasExportDoc(lines, index)
      ) {
        failures.push(`${file}:${index + 1} exported API must have a doc comment`);
      }
    });
  }

  if (isSourceModule(file) && SUPPRESSION_MARKERS.some((marker) => text.includes(marker))) {
    failures.push(`${file} must not suppress TypeScript or lint rules`);
  }

  if (isSourceModule(file) && /\b(?:describe|test|it)\.(?:only|skip)\s*\(/.test(text)) {
    failures.push(`${file} must not commit focused or skipped tests`);
  }

  if (/^tests\/[^/]+\.test\.ts$/.test(file)) {
    failures.push(`${file} must live under its primary module directory`);
  }

  if (file.startsWith(`${WORKFLOW_DIR}/`)) {
    // Extraction and the pin rule are shared with the workflow security policy
    // (./workflow-inventory), so neither gate can be the looser of the two.
    for (const { line, reference } of actionReferences(text)) {
      if (!isPinnedActionReference(reference)) {
        failures.push(`${file}:${line} GitHub Actions must be pinned to commit SHAs`);
      }
    }
  }

  if (isSourceModule(file) && /\.postMessage\([\s\S]{0,400},\s*["']\*["']/.test(text)) {
    failures.push(`${file} must not use wildcard postMessage targets`);
  }

  if (isSourceModule(file) && DYNAMIC_CODE_PATTERN.test(text)) {
    failures.push(`${file} must not use eval-style dynamic code execution`);
  }

  if (isProductionSource(file) && /\bconsole\./.test(text)) {
    failures.push(`${file} must not log from production wallet code`);
  }

  if (
    isProductionSource(file) &&
    isSourceModule(file) &&
    !HTML_SINK_FILES.has(file) &&
    HTML_SINK_PATTERN.test(text)
  ) {
    failures.push(`${file} must not render string HTML outside audited popup code`);
  }

  if (RAW_ERROR_BOUNDARY_FILES.has(file) && /\berror\.message\b/.test(text)) {
    failures.push(`${file} must not expose raw runtime error messages`);
  }

  if (
    isProductionSource(file) &&
    isSourceModule(file) &&
    !SECRET_MATERIAL_FILES.has(file) &&
    SECRET_MATERIAL_PATTERN.test(text)
  ) {
    failures.push(`${file} must keep secret material in approved boundary modules`);
  }

  if (
    (file.startsWith("packages/presentation/wallet-ui/src/popup/") ||
      file.startsWith("packages/presentation/wallet-ui/src/sidepanel/")) &&
    /#[0-9a-fA-F]{3,8}\b|\b(?:black|white)\b/.test(text)
  ) {
    failures.push(`${file} must use skin tokens for colors`);
  }

  if (
    isProductionSource(file) &&
    file !== "apps/extension/src/background/runtime/session.ts" &&
    file !== "apps/extension/src/sidepanel/index.ts" && // side-panel root injects the clock
    file !== "packages/features/portfolio/src/tokens/prices.ts" &&
    file !== "packages/features/transactions/src/activity/activity.ts" &&
    file !== "packages/features/permissions/src/phishing-feed.ts" &&
    /\bDate\.now\(/.test(text)
  ) {
    failures.push(`${file} must keep clock access behind an explicit boundary`);
  }

  if (isProductionSource(file) && /\b(?:new Date|Math\.random)\b/.test(text)) {
    failures.push(`${file} must not use implicit clock or random sources`);
  }

  if (
    isProductionSource(file) &&
    file !== "packages/platform/vault/src/encrypted-store.ts" &&
    /\bcrypto\.getRandomValues\b/.test(text)
  ) {
    failures.push(`${file} must keep raw random bytes behind crypto/storage boundaries`);
  }

  if (
    isProductionSource(file) &&
    !RANDOM_UUID_FILES.has(file) &&
    /\bcrypto\.randomUUID\b/.test(text)
  ) {
    failures.push(`${file} must keep random ids behind approved request-boundary modules`);
  }

  if (
    isSourceModule(file) &&
    file !== "apps/extension/src/browser-storage.ts" &&
    /\b(?:chrome|browser)\.storage\b/.test(text)
  ) {
    failures.push(`${file} must use the storage adapter instead of browser storage directly`);
  }

  if (
    isProductionSource(file) &&
    isSourceModule(file) &&
    !BROWSER_GLOBAL_FILES.has(file) &&
    /\b(?:document|window|globalThis)\./.test(text)
  ) {
    failures.push(`${file} must keep browser globals in explicit entrypoint modules`);
  }

  if (
    isProductionSource(file) &&
    isSourceModule(file) &&
    file !== "apps/extension/src/background/index.ts" &&
    file !== "apps/extension/src/browser-storage.ts" &&
    /createBrowser(?:Local|Session)Store/.test(text)
  ) {
    failures.push(`${file} must not construct browser storage directly`);
  }

  if (
    isProductionSource(file) &&
    isSourceModule(file) &&
    !ENCRYPTED_STORE_WIRING_FILES.has(file) &&
    /\bcreateEncryptedStore\b/.test(text)
  ) {
    failures.push(`${file} must not wire encrypted stores outside the background root`);
  }

  if (
    isProductionSource(file) &&
    isSourceModule(file) &&
    !VAULT_SERVICE_WIRING_FILES.has(file) &&
    /\b(?:createWalletVaultService|VAULT_STORE_KEY)\b/.test(text)
  ) {
    failures.push(`${file} must not wire vault services outside the background root`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}
