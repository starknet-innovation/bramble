/**
 * Static repository configuration policy enforced by check-config-standards.
 */
export const SEMVER = /^\d+\.\d+\.\d+$/;

export const DEPENDENCY_FIELDS = [
  "bundledDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

export const EXPECTED_PACKAGE_MANAGER = "bun@1.3.3";

export const EXPECTED_DEV_DEPENDENCIES: Readonly<Record<string, string>> = {
  "@biomejs/biome": "2.5.5",
  "@happy-dom/global-registrator": "20.11.1",
  "@playwright/test": "1.61.1",
  "@types/bun": "1.3.14",
  "@types/node": "26.1.1",
  "happy-dom": "20.11.1",
  knip: "6.29.0",
  madge: "8.0.0",
  typescript: "6.0.3",
};

export const EXPECTED_DEPENDENCIES: Readonly<Record<string, string>> = {
  "@ledgerhq/hw-app-starknet": "3.0.2",
  "@ledgerhq/hw-transport": "6.35.6",
  "@ledgerhq/hw-transport-webhid": "6.36.0",
  buffer: "5.7.1",
  starknet: "10.0.2",
};

export const PINNED_RUNTIME_FILES = [
  "background/index.js",
  "content/index.js",
  "ledger-grant.html",
  "ledger-grant/index.js",
  "manifest.json",
  "popup.html",
  "provider/inpage.js",
  "sidepanel.html",
  "sidepanel/index.js",
  "vendor/krusty-kms/pkg/krusty_kms_wasm.js",
  "vendor/krusty-kms/pkg/krusty_kms_wasm_bg.wasm",
  "vendor/multisig/multisig.contract_class.json",
] as const;

export const EXPECTED_GITIGNORE_ENTRIES = [
  ".claude/*",
  "artifacts/",
  "dist/",
  "node_modules/",
  "playwright-report/",
  "test-results/",
  "vendor/krusty-kms/",
  "vendor/multisig/",
] as const;

export const EXPECTED_README_SECTIONS = ["## Features", "## Quick start", "## Docs"] as const;

export const EXPECTED_ARCHITECTURE_SECTIONS = [
  "## Architecture",
  "## Migration Workflow",
  "## Design System",
  "## Krusty KMS",
  "## Extension",
] as const;

export const EXPECTED_CONTRIBUTING_SECTIONS = [
  "## Required Gates",
  "## Architecture Rules",
  "## Security Rules",
  "## Code Style",
  "## Documentation",
] as const;

export const EXPECTED_CONTRIBUTING_RULES = [
  "Pure code is the default.",
  "Krusty KMS owns wallet cryptography.",
  "Encrypted stores must validate decrypted data before use.",
  "Stored data access must go through permission checks.",
  "Migrations must be deterministic functions with tests for old, current, and invalid data.",
  "UI code must depend on skin tokens, not hard-coded component-library details.",
  "Runtime dependencies must stay pinned and explicit.",
] as const;

export const EXPECTED_PACKAGE_SCRIPTS: Readonly<Record<string, string>> = {
  build: "bun run scripts/build-extension.ts",
  check:
    "bun run check:types && bun run check:lint && bun run check:files && bun run check:imports && bun run check:cycles && bun run check:extension && bun run check:krusty && bun run check:multisig && bun test ./tests",
  "check:audit": "bun audit --audit-level=high",
  "check:coverage": "bun run scripts/check-coverage.ts",
  "check:cycles": "madge --circular --extensions ts src",
  "check:deadcode": "knip --no-exit-code",
  "check:extension": "bun run scripts/check-extension-manifest.ts",
  "check:files":
    "bun run scripts/check-file-standards.ts && bun run scripts/check-config-standards.ts",
  "check:imports": "bun run scripts/check-import-layers.ts",
  "check:krusty": "bun run scripts/check-krusty-adapter.ts",
  "check:lint": "biome check .",
  "check:multisig": "bun run scripts/check-multisig-class.ts",
  "check:release-version": "bun run scripts/release-version.ts",
  "check:types": "tsc --noEmit",
  changelog: "bun run scripts/generate-changelog.ts",
  format: "biome check --write .",
  "package:extension": "bun run scripts/package-extension.ts",
  "release:publish": "bun run scripts/publish-chrome-web-store.ts",
  test: "bun test ./tests",
  "test:e2e": "playwright test",
  "test:e2e:build": "bun run build && bun run test:e2e",
  "test:e2e:install": "playwright install chromium",
  "vendor:krusty": "bun run scripts/vendor-krusty.ts",
  "vendor:multisig": "bun run scripts/vendor-multisig.ts",
};

export const REQUIRED_BIOME_LINTER_DOMAINS: Readonly<Record<string, string>> = {
  types: "recommended",
};

export const REQUIRED_BIOME_COMPLEXITY_RULES: Readonly<Record<string, string>> = {
  useLiteralKeys: "off",
};

/**
 * Keys that must appear (and only these) under linter.rules.complexity. The
 * cognitive-complexity gate is validated separately because its value is an
 * object rather than a plain level string.
 */
export const BIOME_COMPLEXITY_RULE_KEYS = [
  "noExcessiveCognitiveComplexity",
  "useLiteralKeys",
] as const;

/**
 * Repo-wide cognitive-complexity ceiling. Current non-wallet code passes at 35.
 */
export const REPO_MAX_COGNITIVE_COMPLEXITY = 35;

/**
 * Strict cognitive-complexity ceiling for the refactored wallet-logic modules.
 */
export const WALLET_MAX_COGNITIVE_COMPLEXITY = 12;

/**
 * Globs that receive the strict wallet-logic cognitive-complexity override.
 */
export const WALLET_COMPLEXITY_GLOBS = [
  "src/wallet/**",
  "src/background/**",
  "src/starknet/**",
  "src/storage/**",
  "src/shared/**",
  "src/provider/**",
] as const;

export const REQUIRED_BIOME_NURSERY_RULES: Readonly<Record<string, string>> = {
  noFloatingPromises: "error",
};

export const REQUIRED_COMPILER_OPTIONS: Readonly<Record<string, boolean>> = {
  allowJs: false,
  exactOptionalPropertyTypes: true,
  forceConsistentCasingInFileNames: true,
  isolatedModules: true,
  noEmit: true,
  noFallthroughCasesInSwitch: true,
  noImplicitOverride: true,
  noImplicitReturns: true,
  noPropertyAccessFromIndexSignature: true,
  noUncheckedIndexedAccess: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  skipLibCheck: false,
  strict: true,
  useUnknownInCatchVariables: true,
  verbatimModuleSyntax: true,
};
