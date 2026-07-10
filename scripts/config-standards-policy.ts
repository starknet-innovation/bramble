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
  "@biomejs/biome": "2.5.2",
  "@playwright/test": "1.61.1",
  "@types/bun": "1.3.14",
  typescript: "6.0.3",
};

export const EXPECTED_DEPENDENCIES: Readonly<Record<string, string>> = {
  starknet: "10.0.2",
};

export const PINNED_RUNTIME_FILES = [
  "background/index.js",
  "content/index.js",
  "manifest.json",
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

export const EXPECTED_README_SECTIONS = [
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
    "bun run check:types && bun run check:lint && bun run check:files && bun run check:extension && bun run check:krusty && bun run check:multisig && bun test",
  "check:audit": "bun audit --audit-level=high",
  "check:extension": "bun run scripts/check-extension-manifest.ts",
  "check:files":
    "bun run scripts/check-file-standards.ts && bun run scripts/check-config-standards.ts",
  "check:krusty": "bun run scripts/check-krusty-adapter.ts",
  "check:lint": "biome check .",
  "check:multisig": "bun run scripts/check-multisig-class.ts",
  "check:types": "tsc --noEmit",
  format: "biome check --write .",
  "package:extension": "bun run scripts/package-extension.ts",
  test: "bun test",
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
