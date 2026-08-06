/**
 * Enforces repository file-size and TypeScript doc-comment standards.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const MAX_LINES = 500;
const EXCLUDED = new Set([
  ".claude",
  ".git",
  ".impeccable",
  ".playwright-cli",
  "apps",
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
const BROWSER_GLOBAL_FILES = new Set([
  "src/background/index.ts",
  "src/content/index.ts",
  "src/ledger-grant/index.ts",
  "src/provider/inpage.ts",
  "src/sandbox/render.ts",
  "src/sidepanel/dom.ts",
  "src/sidepanel/activity-ui.ts",
  "src/sidepanel/index.ts",
  "src/sidepanel/ledger/grant-window.ts",
  "src/sidepanel/scene-renderer.ts",
  "src/sidepanel/settings-ui.ts",
  "src/sidepanel/transfer-ui.ts",
  "src/storage/browser-storage.ts",
]);
const ENCRYPTED_STORE_WIRING_FILES = new Set([
  "src/background/index.ts",
  "src/storage/encrypted-store.ts",
]);
const RANDOM_UUID_FILES = new Set([
  "src/background/approvals.ts",
  "src/provider/inpage.ts",
  "src/sidepanel/ledger/grant-window.ts",
]);
const RAW_ERROR_BOUNDARY_FILES = new Set(["src/background/index.ts", "src/content/index.ts"]);
const SECRET_MATERIAL_FILES = new Set([
  "src/background/account-hash-signer.ts",
  "src/background/account-creation-inputs.ts",
  "src/background/add-chain-ops.ts",
  "src/background/approval-decisions.ts",
  "src/background/chain-ops.ts",
  "src/background/discovery-ops.ts",
  "src/background/declare-ops.ts",
  "src/background/import-inputs.ts",
  "src/background/ledger-ops.ts",
  "src/background/ledger-sign-queue.ts",
  "src/background/ledger-signer.ts",
  "src/background/signature-waiters.ts",
  "src/background/index.ts",
  "src/background/message-inputs.ts",
  // Wires collaborators by name only. Its sole match is the `./signature-waiters`
  // import path; it holds no secret material and touches no key operations.
  "src/background/message-context.ts",
  "src/background/messages.ts",
  "src/background/provider-ops.ts",
  "src/background/origins-ops.ts",
  "src/background/strk20-account-context.ts",
  "src/background/strk20-ops.ts",
  "src/background/strk20-wallet-ops.ts",
  "src/background/runtime-state.ts",
  "src/background/runtime-types.ts",
  "src/background/session.ts",
  "src/ledger-grant/broker-protocol.ts",
  "src/background/unlock-errors.ts",
  "src/background/wallet-ops.ts",
  "src/background/wallet-reader.ts",
  "src/background/ledger-inputs.ts",
  "src/crypto/krusty.ts",
  "src/popup/responses.ts",
  "src/popup/responses-ledger.ts",
  "src/provider/bridge-results.ts",
  "src/provider/bridge.ts",
  "src/sidepanel/dom.ts",
  "src/sidepanel/gate-views.ts",
  "src/sidepanel/ledger/client.ts",
  "src/sidepanel/ledger/errors.ts",
  "src/sidepanel/ledger/first-run.ts",
  "src/sidepanel/ledger/onboard-entry.ts",
  "src/sidepanel/ledger/runtime-client.ts",
  "src/sidepanel/ledger/sign-runtime.ts",
  "src/sidepanel/ledger/sign-session.ts",
  "src/sidepanel/ledger/sign-views.ts",
  "src/sidepanel/import-key-ui.ts",
  "src/sidepanel/index.ts",
  "src/sidepanel/onboarding-ui.ts",
  "src/sidepanel/onboarding-views.ts",
  "src/sidepanel/reveal-ui.ts",
  "src/sidepanel/runtime.ts",
  "src/starknet/ledger-verify.ts",
  "src/starknet/provider.ts",
  "src/starknet/rpc.ts",
  "src/starknet/strk20/call-set-signer.ts",
  "src/starknet/strk20/official-sdk-service.ts",
  // CallSet signing and viewing-key wiring extracted from official-sdk-service;
  // same Krusty-delegated boundary, no secret ever stored or logged here.
  "src/starknet/strk20/official-sdk-transfers.ts",
  "src/starknet/strk20/paymaster.ts",
  "src/starknet/strk20/service.ts",
  "src/storage/encrypted-store.ts",
  "src/storage/migrations.ts",
  "src/storage/vault-schema.ts",
  "src/storage/vault-account-secrets.ts",
  "src/storage/vault-store-migration.ts",
  "src/wallet/accounts.ts",
  "src/wallet/strk20-viewing-key.ts",
  "src/wallet/vault-network-account.ts",
  "src/wallet/vault-reveal.ts",
  "src/wallet/vault-service.ts",
  "src/wallet/vault-service-types.ts",
]);
const SECRET_MATERIAL_PATTERN =
  /\b(?:mnemonic|mnemonicPassphrase|passphrase|privateKey|seed|signature|signingKey|signingKeys|vaultPassphrase)\b/i;
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
const GITHUB_ACTION_REF_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/;
const HTML_SINK_FILES = new Set([
  "src/sidepanel/dom.ts",
  "src/sidepanel/index.ts",
  "src/sidepanel/tokens-ui.ts",
  "src/sidepanel/transfer-ui.ts",
  // Swap screen dynamic regions (chips, picker rows, receipts): every
  // interpolation passes through escapeHtml/tokenGlyph — audited 2026-07.
  "src/sidepanel/swap-ui.ts",
  "src/sidepanel/swap-picker.ts",
  // Shell replacement extracted from the sidepanel entrypoint; it receives
  // fully escaped production templates and owns no dynamic template content.
  "src/sidepanel/scene-renderer.ts",
  // Collectible animation renderer: document.write of the untrusted on-chain
  // data:text/html, confined by the manifest sandbox page's isolated security
  // principal and egress-blocking CSP (never executed in a privileged page) —
  // audited 2026-07.
  "src/sandbox/render.ts",
]);
const HTML_SINK_PATTERN =
  /\b(?:createContextualFragment|document\.write|innerHTML|insertAdjacentHTML|outerHTML|srcdoc)\b/;
const VAULT_SERVICE_WIRING_FILES = new Set([
  "src/background/index.ts",
  "src/wallet/vault-service.ts",
]);

const failures: string[] = [];

const hasExportDoc = (lines: readonly string[], index: number): boolean => {
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const line = lines[previous]?.trim();
    if (line === "") {
      continue;
    }
    return line === "*/";
  }
  return false;
};

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (EXCLUDED.has(entry.name)) {
      continue;
    }

    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (entry.isFile()) {
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

  if (file.startsWith("src/") && file.endsWith(".ts")) {
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

  if (file.startsWith(".github/workflows/")) {
    lines.forEach((line, index) => {
      const actionRef = line.match(/^\s*-\s+uses:\s*(\S+)/)?.[1];
      if (actionRef && !GITHUB_ACTION_REF_PATTERN.test(actionRef)) {
        failures.push(`${file}:${index + 1} GitHub Actions must be pinned to commit SHAs`);
      }
    });
  }

  if (file.endsWith(".ts") && /\.postMessage\([\s\S]{0,400},\s*["']\*["']/.test(text)) {
    failures.push(`${file} must not use wildcard postMessage targets`);
  }

  if (file.endsWith(".ts") && DYNAMIC_CODE_PATTERN.test(text)) {
    failures.push(`${file} must not use eval-style dynamic code execution`);
  }

  if (file.startsWith("src/") && /\bconsole\./.test(text)) {
    failures.push(`${file} must not log from production wallet code`);
  }

  if (
    file.startsWith("src/") &&
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
    file.startsWith("src/") &&
    file.endsWith(".ts") &&
    !SECRET_MATERIAL_FILES.has(file) &&
    SECRET_MATERIAL_PATTERN.test(text)
  ) {
    failures.push(`${file} must keep secret material in approved boundary modules`);
  }

  if (
    (file.startsWith("src/popup/") || file.startsWith("src/sidepanel/")) &&
    /#[0-9a-fA-F]{3,8}\b|\b(?:black|white)\b/.test(text)
  ) {
    failures.push(`${file} must use skin tokens for colors`);
  }

  if (
    file.startsWith("src/") &&
    file !== "src/background/session.ts" &&
    file !== "src/starknet/prices.ts" &&
    file !== "src/storage/activity-store.ts" &&
    /\bDate\.now\(/.test(text)
  ) {
    failures.push(`${file} must keep clock access behind an explicit boundary`);
  }

  if (file.startsWith("src/") && /\b(?:new Date|Math\.random)\b/.test(text)) {
    failures.push(`${file} must not use implicit clock or random sources`);
  }

  if (
    file.startsWith("src/") &&
    file !== "src/storage/encrypted-store.ts" &&
    /\bcrypto\.getRandomValues\b/.test(text)
  ) {
    failures.push(`${file} must keep raw random bytes behind crypto/storage boundaries`);
  }

  if (
    file.startsWith("src/") &&
    !RANDOM_UUID_FILES.has(file) &&
    /\bcrypto\.randomUUID\b/.test(text)
  ) {
    failures.push(`${file} must keep random ids behind approved request-boundary modules`);
  }

  if (
    file.endsWith(".ts") &&
    file !== "src/storage/browser-storage.ts" &&
    /\b(?:chrome|browser)\.storage\b/.test(text)
  ) {
    failures.push(`${file} must use the storage adapter instead of browser storage directly`);
  }

  if (
    file.startsWith("src/") &&
    file.endsWith(".ts") &&
    !BROWSER_GLOBAL_FILES.has(file) &&
    /\b(?:document|window|globalThis)\./.test(text)
  ) {
    failures.push(`${file} must keep browser globals in explicit entrypoint modules`);
  }

  if (
    file.startsWith("src/") &&
    file.endsWith(".ts") &&
    file !== "src/background/index.ts" &&
    file !== "src/storage/browser-storage.ts" &&
    /createBrowser(?:Local|Session)Store/.test(text)
  ) {
    failures.push(`${file} must not construct browser storage directly`);
  }

  if (
    file.startsWith("src/") &&
    file.endsWith(".ts") &&
    !ENCRYPTED_STORE_WIRING_FILES.has(file) &&
    /\bcreateEncryptedStore\b/.test(text)
  ) {
    failures.push(`${file} must not wire encrypted stores outside the background root`);
  }

  if (
    file.startsWith("src/") &&
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
