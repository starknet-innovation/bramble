/**
 * Enforces repository file-size and TypeScript doc-comment standards.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SECRET_MATERIAL_FILES } from "./file-standards-policy";
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
  "dist",
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
const EXCLUDED_PATHS = new Set(["apps/terminal", "apps/ui-lab"]);
const BINARY_EXTENSIONS = [".jpg", ".png", ".wasm", ".webp", ".zip"] as const;
const BROWSER_GLOBAL_FILES = new Set([
  "apps/extension/src/background/index.ts",
  "apps/extension/src/content/index.ts",
  "apps/extension/src/ledger-grant/index.ts",
  "apps/extension/src/pq-grant/index.ts",
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
const RAW_RANDOM_FILES = new Set([
  "packages/platform/vault/src/encrypted-store.ts",
  // Mints the single-use proof-of-possession challenge a device signs before
  // enrollment. A predictable one would let an attacker enroll a foreign key.
  "apps/extension/src/background/devices/mobile-pq-enrollment.ts",
]);
const RANDOM_UUID_FILES = new Set([
  "apps/extension/src/background/approvals/approvals.ts",
  "apps/extension/src/provider/inpage.ts",
  // Mints the per-tab session capability naming the paired-phone broker channel.
  // Unguessable by requirement: a device page opened independently must not be
  // able to reach a command channel.
  "apps/extension/src/sidepanel/index.ts",
  "packages/platform/ledger-browser/src/grant-window.ts",
]);
const RAW_ERROR_BOUNDARY_FILES = new Set([
  "apps/extension/src/background/index.ts",
  "apps/extension/src/content/index.ts",
]);
const SECRET_MATERIAL_PATTERN =
  /\b(?:accountSecrets|mnemonic|mnemonicPassphrase|passphrase|privateKey|seed|signature|signingKey|signingKeys|vaultPassphrase|viewingKey)\b/i;
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

const isProductionTypeScript = (file: string): boolean =>
  file.startsWith("apps/extension/src/") || /^packages\/[^/]+\/[^/]+\/src\//.test(file);

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

  if (file.endsWith(".ts") && !text.trimStart().startsWith("/**")) {
    failures.push(`${file} must start with a doc comment`);
  }

  if (file.endsWith(".ts") && hasControlByte(text)) {
    failures.push(`${file} must not contain raw control bytes (use a \\u escape)`);
  }

  if (isProductionTypeScript(file) && file.endsWith(".ts")) {
    lines.forEach((line, index) => {
      if (
        /^export (?:\{|class|const|function|interface|type)\b/.test(line) &&
        !hasExportDoc(lines, index)
      ) {
        failures.push(`${file}:${index + 1} exported API must have a doc comment`);
      }
    });
  }

  if (file.endsWith(".ts") && SUPPRESSION_MARKERS.some((marker) => text.includes(marker))) {
    failures.push(`${file} must not suppress TypeScript or lint rules`);
  }

  if (file.endsWith(".ts") && /\b(?:describe|test|it)\.(?:only|skip)\s*\(/.test(text)) {
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

  if (file.endsWith(".ts") && /\.postMessage\([\s\S]{0,400},\s*["']\*["']/.test(text)) {
    failures.push(`${file} must not use wildcard postMessage targets`);
  }

  if (file.endsWith(".ts") && DYNAMIC_CODE_PATTERN.test(text)) {
    failures.push(`${file} must not use eval-style dynamic code execution`);
  }

  if (isProductionTypeScript(file) && /\bconsole\./.test(text)) {
    failures.push(`${file} must not log from production wallet code`);
  }

  if (
    isProductionTypeScript(file) &&
    file.endsWith(".ts") &&
    !HTML_SINK_FILES.has(file) &&
    HTML_SINK_PATTERN.test(text)
  ) {
    failures.push(`${file} must not render string HTML outside audited popup code`);
  }

  if (RAW_ERROR_BOUNDARY_FILES.has(file) && /\berror\.message\b/.test(text)) {
    failures.push(`${file} must not expose raw runtime error messages`);
  }

  if (
    isProductionTypeScript(file) &&
    file.endsWith(".ts") &&
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
    isProductionTypeScript(file) &&
    file !== "apps/extension/src/background/runtime/session.ts" &&
    file !== "packages/features/portfolio/src/tokens/prices.ts" &&
    file !== "packages/features/transactions/src/activity/activity.ts" &&
    file !== "packages/features/permissions/src/phishing-feed.ts" &&
    /\bDate\.now\(/.test(text)
  ) {
    failures.push(`${file} must keep clock access behind an explicit boundary`);
  }

  if (isProductionTypeScript(file) && /\b(?:new Date|Math\.random)\b/.test(text)) {
    failures.push(`${file} must not use implicit clock or random sources`);
  }

  if (
    isProductionTypeScript(file) &&
    !RAW_RANDOM_FILES.has(file) &&
    /\bcrypto\.getRandomValues\b/.test(text)
  ) {
    failures.push(`${file} must keep raw random bytes behind crypto/storage boundaries`);
  }

  if (
    isProductionTypeScript(file) &&
    !RANDOM_UUID_FILES.has(file) &&
    /\bcrypto\.randomUUID\b/.test(text)
  ) {
    failures.push(`${file} must keep random ids behind approved request-boundary modules`);
  }

  if (
    file.endsWith(".ts") &&
    file !== "apps/extension/src/browser-storage.ts" &&
    /\b(?:chrome|browser)\.storage\b/.test(text)
  ) {
    failures.push(`${file} must use the storage adapter instead of browser storage directly`);
  }

  if (
    isProductionTypeScript(file) &&
    file.endsWith(".ts") &&
    !BROWSER_GLOBAL_FILES.has(file) &&
    /\b(?:document|window|globalThis)\./.test(text)
  ) {
    failures.push(`${file} must keep browser globals in explicit entrypoint modules`);
  }

  if (
    isProductionTypeScript(file) &&
    file.endsWith(".ts") &&
    file !== "apps/extension/src/background/index.ts" &&
    file !== "apps/extension/src/browser-storage.ts" &&
    /createBrowser(?:Local|Session)Store/.test(text)
  ) {
    failures.push(`${file} must not construct browser storage directly`);
  }

  if (
    isProductionTypeScript(file) &&
    file.endsWith(".ts") &&
    !ENCRYPTED_STORE_WIRING_FILES.has(file) &&
    /\bcreateEncryptedStore\b/.test(text)
  ) {
    failures.push(`${file} must not wire encrypted stores outside the background root`);
  }

  if (
    isProductionTypeScript(file) &&
    file.endsWith(".ts") &&
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
