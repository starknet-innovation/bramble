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

export const EXPECTED_WORKSPACES = ["apps/*", "packages/*/*"] as const;

export const EXPECTED_DEV_DEPENDENCIES: Readonly<Record<string, string>> = {
  "@bramble/testkit": "workspace:*",
  "@biomejs/biome": "2.5.14",
  "@playwright/test": "1.63.0",
  // BIP-32/BIP-39 for the vendor-import dataset tooling in tools/vendor-dataset,
  // which reimplements the vendors' own derivation so the dataset stays
  // independent of the Krusty code it measures. Development scripts only: the
  // workspace-architecture gate keeps every shipped workspace from importing a
  // root devDependency. Both versions are the ones bun.lock already resolved.
  "@scure/bip32": "1.7.0",
  "@scure/bip39": "1.6.0",
  "@types/bun": "1.4.2",
  "@types/node": "26.6.2",
  "fast-check": "4.10.2",
  knip: "6.37.0",
  madge: "8.0.0",
  typescript: "6.0.3",
  // Mozilla's own add-on tooling. `web-ext lint` wraps the exact validator
  // addons.mozilla.org runs at submission, so the Gecko artifact is judged by
  // the same rules before a human uploads it; the same tool later signs and
  // submits. Pinned exact and never shipped — it is a build-time gate only.
  "web-ext": "10.7.0",
};

export const EXPECTED_DEPENDENCIES: Readonly<Record<string, string>> = {
  "@bramble/core": "workspace:*",
  "@bramble/kms-krusty": "workspace:*",
  "@bramble/ledger-protocol": "workspace:*",
  "@bramble/multisig": "workspace:*",
  "@bramble/permissions": "workspace:*",
  "@bramble/privacy": "workspace:*",
  "@bramble/portfolio": "workspace:*",
  "@bramble/starknet": "workspace:*",
  "@bramble/store": "workspace:*",
  "@bramble/settings": "workspace:*",
  "@bramble/transactions": "workspace:*",
  "@bramble/ui-kit": "workspace:*",
  "@bramble/vault": "workspace:*",
  "@bramble/wallet-ui": "workspace:*",
  "@bramble/wallet-model": "workspace:*",
  "@bramble/wallet-protocol": "workspace:*",
  "@starknetfoundation/krusty-kms-wasm": "0.11.0",
  starknet: "10.8.0",
};

export const PINNED_RUNTIME_FILES = [
  "background/index.js",
  "brand/onboarding-landscape.webp",
  "content/index.js",
  "dependencies/krusty-kms/krusty_kms_wasm.js",
  "dependencies/krusty-kms/krusty_kms_wasm_bg.wasm",
  "icons/icon-128.png",
  "icons/icon-16.png",
  "icons/icon-24.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "ledger-grant.html",
  "ledger-grant/index.js",
  "manifest.json",
  "onboarding.html",
  "popup.html",
  "provider/inpage.js",
  "sandbox/render.html",
  "sandbox/render.js",
  "sidepanel.html",
  "sidepanel/index.js",
  "vendor/starknet-privacy/sdk/starknet-sdk.min.js",
] as const;

export const EXPECTED_GITIGNORE_ENTRIES = [
  ".claude/*",
  ".dev-profile/",
  // Bun auto-loads a bare `.env`, which makes it the natural place a developer
  // puts BRAMBLE_DEV_MNEMONIC. Keeping it ignored is what stops a recovery phrase
  // reaching a commit.
  ".env",
  "artifacts/",
  "dist/",
  "dist-firefox/",
  "node_modules/",
  "playwright-report/",
  "test-results/",
  "vendor/argent-contracts/",
  "vendor/starknet-privacy/",
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
  build: "bun run --filter @bramble/extension build",
  "build:all": "bun run --filter @bramble/extension build:all",
  "build:firefox": "bun run --filter @bramble/extension build:firefox",
  check:
    "bun run check:types && bun run check:lint && bun run check:files && bun run check:copy && bun run check:imports && bun run check:cycles && bun run check:deadcode && bun run check:extension && bun run check:krusty && bun run check:argent && bun run check:privacy && bun run test && bun run check:workspaces",
  "check:audit": "bun audit --audit-level=high --ignore=GHSA-86w9-cpqp-85rv",
  // Warns only, never fails: wording is a judgement call. See docs/COPY_STYLE.md.
  "check:copy": "bun run scripts/check-copy.ts",
  "check:coverage": "bun run scripts/check-coverage.ts",
  "check:cycles": "madge --circular --extensions ts apps/extension/src packages",
  "check:deadcode": "knip",
  "check:extension": "bun run scripts/check-extension-manifest.ts",
  "check:firefox": "web-ext lint --source-dir dist-firefox",
  "check:files":
    "bun run scripts/check-file-standards.ts && bun run scripts/check-config-standards.ts",
  "check:imports": "bun run scripts/check-workspace-architecture.ts",
  "check:krusty": "bun run scripts/check-krusty-adapter.ts",
  "check:lint": "biome check .",
  "check:argent": "bun run scripts/check-argent-contracts.ts",
  "check:privacy": "bun run scripts/check-privacy-sdk.ts",
  "check:release-version": "bun run scripts/release-version.ts",
  "check:types": "tsc --noEmit",
  "check:workspaces":
    "bun run --filter './packages/foundation/**' check && bun run --filter './packages/platform/**' check && bun run --filter './packages/features/**' check && bun run --filter './packages/presentation/**' check && bun run --filter './packages/testing/**' check && bun run --filter @bramble/extension check && bun run --filter @bramble/terminal check && bun run --filter @bramble/ui-lab check:static && bun run --filter @bramble/website check",
  changelog: "bun run scripts/generate-changelog.ts",
  "dev:session": "bun run tests/e2e/dev-session.ts",
  format: "biome check --write .",
  // Regenerate the mobile wallet's single-sourced tokens/networks and its extension-parity vectors.
  "mobile:assets": "bun run scripts/generate-mobile-assets.ts",
  "mobile:parity": "bun run scripts/generate-mobile-parity-vectors.ts",
  // Pinned strict SwiftLint/ktlint/detekt (mobile/scripts/lint-tools.sh). Kept out of `check`:
  // it needs macOS and a JDK, and `check` must pass on Linux CI and machines without them.
  "mobile:lint": "bash mobile/scripts/lint.sh all",
  "package:extension": "bun run scripts/package-extension.ts",
  "package:extension:firefox": "bun run scripts/package-extension.ts --target=firefox",
  "release:publish": "bun run scripts/publish-chrome-web-store.ts",
  test: "bun test ./tests",
  "test:e2e": "playwright test",
  "test:e2e:build": "bun run build && bun run test:e2e",
  "test:e2e:install": "playwright install chromium",
  "test:e2e:mainnet": "playwright test --config playwright.mainnet.config.ts",
  "vendor:argent": "bun run scripts/vendor-argent-contracts.ts",
  "vendor:privacy": "bun run scripts/vendor-privacy-sdk.ts",
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
  "apps/extension/src/background/**",
  "apps/extension/src/provider/**",
  "packages/foundation/core/src/**",
  "packages/foundation/wallet-model/src/**",
  "packages/foundation/wallet-protocol/src/**",
  "packages/platform/store/src/**",
  "packages/platform/vault/src/**",
  "packages/platform/kms-krusty/src/**",
  "packages/platform/ledger-browser/src/**",
  "packages/platform/ledger-protocol/src/**",
  "packages/platform/starknet/src/**",
  "packages/features/privacy/src/**",
  "packages/features/multisig/src/**",
  "packages/features/portfolio/src/**",
  "packages/features/permissions/src/**",
  "packages/features/transactions/src/**",
  "packages/features/settings/src/**",
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
