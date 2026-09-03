/**
 * Enforces repository file-size and TypeScript doc-comment standards.
 */
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
  "apps/extension/src/background/approvals/approvals.ts",
  "apps/extension/src/provider/inpage.ts",
  "packages/platform/ledger-browser/src/grant-window.ts",
]);
const RAW_ERROR_BOUNDARY_FILES = new Set([
  "apps/extension/src/background/index.ts",
  "apps/extension/src/content/index.ts",
]);
const SECRET_MATERIAL_FILES = new Set([
  "apps/extension/src/background/ledger/account-hash-signer.ts",
  "apps/extension/src/background/accounts/account-creation-inputs.ts",
  // Privileged first-run boundary: the phrase is validated through Krusty and
  // only the boolean verdict returns; the phrase is never logged or persisted.
  "apps/extension/src/background/onboarding/onboarding-ops.ts",
  "apps/extension/src/background/routing/account-creation-handlers.ts",
  // Keeps the unlocked vault credential inside the privileged worker while
  // coordinating fail-closed network/vault commits; never persists or emits it.
  "apps/extension/src/background/runtime/active-network-mutation.ts",
  "apps/extension/src/background/provider/add-chain-ops.ts",
  "apps/extension/src/background/approvals/approval-decisions.ts",
  "apps/extension/src/background/transactions/chain-ops.ts",
  "apps/extension/src/background/portfolio/discovery-ops.ts",
  "apps/extension/src/background/transactions/declare-ops.ts",
  "apps/extension/src/background/accounts/import-inputs.ts",
  "apps/extension/src/background/ledger/ledger-ops.ts",
  "apps/extension/src/background/ledger/ledger-sign-queue.ts",
  "apps/extension/src/background/ledger/ledger-signer.ts",
  "apps/extension/src/background/approvals/signature-waiters.ts",
  "apps/extension/src/background/index.ts",
  "apps/extension/src/background/routing/message-inputs.ts",
  // Wires collaborators by name only. Its sole match is the `./signature-waiters`
  // import path; it holds no secret material and touches no key operations.
  "apps/extension/src/background/routing/message-context.ts",
  "apps/extension/src/background/routing/messages.ts",
  "apps/extension/src/background/provider/provider-ops.ts",
  "apps/extension/src/background/settings/origins-ops.ts",
  "apps/extension/src/background/privacy/strk20-account-context.ts",
  // Approved-request execution split out of strk20-ops.ts: it re-resolves the
  // granted account behind a non-renewing session peek and hands the unlocked
  // vault credential straight to the protected signer wiring. Same boundary,
  // same rule — never logged, persisted, or returned across a message.
  "apps/extension/src/background/privacy/strk20-approval-execution.ts",
  // Queues approvals only. Since the execution half moved out, its sole match
  // is the `./signature-waiters` import path; no secret material transits here.
  "apps/extension/src/background/privacy/strk20-ops.ts",
  // Active-account context split from strk20-wallet-ops; the vault passphrase
  // only transits into the protected signer wiring, never logged or stored.
  "apps/extension/src/background/privacy/strk20-op-context.ts",
  "apps/extension/src/background/privacy/strk20-wallet-ops.ts",
  "apps/extension/src/background/runtime/runtime-state.ts",
  "apps/extension/src/background/runtime/runtime-types.ts",
  "apps/extension/src/background/runtime/session.ts",
  "packages/platform/ledger-protocol/src/broker.ts",
  "apps/extension/src/background/routing/unlock-errors.ts",
  "apps/extension/src/background/accounts/wallet-ops.ts",
  "apps/extension/src/background/accounts/wallet-reader.ts",
  "apps/extension/src/background/ledger/ledger-inputs.ts",
  "packages/platform/kms-krusty/src/adapter.ts",
  "packages/foundation/wallet-model/src/accounts/signing.ts",
  // Pure length policy only; carries no passphrase value across a boundary.
  "packages/foundation/wallet-model/src/preferences/passphrase.ts",
  "packages/testing/testkit/src/fake-kms.ts",
  "packages/presentation/wallet-ui/src/popup/responses/responses.ts",
  "packages/presentation/wallet-ui/src/popup/responses/responses-ledger.ts",
  "packages/foundation/wallet-protocol/src/provider/results.ts",
  "packages/foundation/wallet-protocol/src/provider/bridge.ts",
  "packages/presentation/wallet-ui/src/sidepanel/shared/dom.ts",
  "packages/presentation/wallet-ui/src/sidepanel/app/rendering/focus-memo.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/gate-views.ts",
  "packages/platform/ledger-protocol/src/client.ts",
  "packages/platform/ledger-protocol/src/errors.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/ledger/first-run.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/ledger/onboard-entry.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/ledger/runtime-client.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/ledger/sign-runtime.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/ledger/sign-session.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/ledger/sign-views.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/settings/import-key-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/settings/import-phrase-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/app/start.ts",
  // English BIP39 word list embeds the token `seed`; assist-only, never crypto.
  "packages/presentation/wallet-ui/src/recovery/bip39-english.ts",
  "packages/presentation/wallet-ui/src/popup/responses/responses-onboarding.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/import-key-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/onboarding-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/onboarding-views.ts",
  // Recovery discovery keeps the phrase and vault credential only in the
  // first-run DOM closure and forwards them to the privileged background.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/recovery-account-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/recovery-import-bind.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/recovery-word-assist.ts",
  // Locked-gate UI forwards the passphrase to the privileged background and
  // neither persists it nor renders it.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/unlock-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/settings/reveal-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/runtime/runtime.ts",
  // Privileged UI message client: credentials transit directly to the
  // background and are never retained or rendered here.
  "packages/presentation/wallet-ui/src/sidepanel/runtime/runtime-accounts.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/onboarding-runtime.ts",
  // Public Argent multisig packages and verified signature fragments cross
  // these UI boundaries; no private signing material is ever present.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/multisig/multisig-model.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/multisig/multisig-runtime.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/multisig/multisig-ui.ts",
  // Public intent packages and verified public signature fragments only; all
  // private signing remains inside the privileged background/Krusty boundary.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/multisig/multisig-intent-ui.ts",
  // Renders public signature-fragment transport controls only; private signing
  // remains behind the privileged background accountHashSigner boundary.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/multisig/multisig-intent-actions.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/multisig/multisig-views.ts",
  "packages/features/transactions/src/routing/ledger-verify.ts",
  // Pure public-key verification consolidated for Ledger and KMS probe
  // callers; it receives no private key or vault credential.
  "packages/platform/starknet/src/transactions/signature-verify.ts",
  // Public account ABI serialization and signer façades. These files carry
  // public keys/signature fragments; private-key operations remain in Krusty.
  "packages/platform/starknet/src/accounts/account-contracts.ts",
  "packages/platform/starknet/src/rpc/account-signer.ts",
  "packages/platform/starknet/src/rpc/multisig-invoke.ts",
  "packages/platform/starknet/src/rpc/rpc-estimate.ts",
  "packages/platform/starknet/src/transactions/declare.ts",
  "packages/platform/starknet/src/transactions/deployment.ts",
  "packages/platform/starknet/src/rpc/provider.ts",
  "packages/platform/starknet/src/rpc/rpc.ts",
  "packages/features/privacy/src/policy/call-set-signer.ts",
  "packages/features/privacy/src/sdk/official-sdk-service.ts",
  // CallSet signing and viewing-key wiring extracted from official-sdk-service;
  // same Krusty-delegated boundary, no secret ever stored or logged here.
  "packages/features/privacy/src/sdk/official-sdk-transfers.ts",
  "packages/features/privacy/src/paymaster/paymaster.ts",
  "packages/features/privacy/src/service.ts",
  // Argent multisig stores public signer identifiers and verified public
  // signature fragments only. Private signing remains behind Krusty and the
  // privileged background accountHashSigner boundary.
  "packages/features/multisig/src/chain.ts",
  "packages/features/multisig/src/deploy.ts",
  "packages/features/multisig/src/repository-schema.ts",
  "apps/extension/src/background/multisig/multisig-deploy-ops.ts",
  "apps/extension/src/background/multisig/multisig-inputs.ts",
  // Explicit user-triggered coordination keeps the vault credential inside the
  // privileged worker while Krusty opens or wraps payloads; it is never stored.
  "apps/extension/src/background/multisig/multisig-coordination-ops.ts",
  "apps/extension/src/background/multisig/multisig-tx-ops.ts",
  "packages/platform/vault/src/accounts/account-secrets.ts",
  "packages/platform/vault/src/encrypted-store.ts",
  "packages/platform/vault/src/kms-port.ts",
  "packages/platform/vault/src/schema/migrations.ts",
  "packages/platform/vault/src/schema/schema-types.ts",
  "packages/platform/vault/src/schema/schema.ts",
  "packages/platform/vault/src/schema/store-migration.ts",
  "packages/platform/vault/src/accounts/accounts.ts",
  "packages/platform/vault/src/accounts/strk20-viewing-key.ts",
  "packages/platform/vault/src/accounts/network-account.ts",
  "packages/platform/vault/src/service/reveal.ts",
  "packages/platform/vault/src/service/service-creation.ts",
  // Atomic recovery re-derives selected accounts and writes their protected
  // keys directly into the encrypted vault; no secret is returned or logged.
  "packages/platform/vault/src/service/recovery.ts",
  // Wallet-level Nostr derivation and application-data crypto stay behind the
  // same encrypted-vault/Krusty boundary and never return private material.
  "packages/platform/vault/src/service/nostr.ts",
  "packages/platform/vault/src/service/service.ts",
  "packages/platform/vault/src/service/service-types.ts",
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
    file !== "packages/platform/vault/src/encrypted-store.ts" &&
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
