/**
 * Source roots whose implementation files must live in named capability folders.
 */
export const STRUCTURED_SOURCE_ROOTS: Readonly<Record<string, readonly string[]>> = {
  "apps/extension/src/background": ["index.ts"],
  "apps/terminal/src/data": ["index.ts"],
  "apps/terminal/src/protocols": ["constants.ts", "index.ts", "types.ts"],
  "apps/terminal/src/screens": [],
  "apps/terminal/src/wallet": [],
  "apps/ui-lab/src": [],
  "packages/features/portfolio/src": [],
  "packages/features/privacy/src": ["config.ts", "service.ts"],
  "packages/features/transactions/src": [],
  "packages/foundation/wallet-model/src": [],
  "packages/foundation/wallet-protocol/src": [],
  "packages/platform/starknet/src": [],
  "packages/platform/vault/src": ["encrypted-store.ts", "kms-port.ts"],
  "packages/presentation/ui-kit/src": [],
  "packages/presentation/wallet-ui/src/popup": ["actions.ts"],
  "packages/presentation/wallet-ui/src/sidepanel": ["index.ts"],
  "packages/presentation/wallet-ui/src/sidepanel/app": ["start.ts"],
};

/**
 * Workspace packages each isolated extension surface may import.
 */
export const EXTENSION_SURFACE_EDGES: Readonly<Record<string, readonly string[]>> = {
  content: ["@mc-wallet/wallet-protocol"],
  "ledger-grant": ["@mc-wallet/ledger-browser", "@mc-wallet/ledger-protocol", "@mc-wallet/ui-kit"],
  provider: ["@mc-wallet/wallet-protocol"],
  sandbox: [],
  sidepanel: ["@mc-wallet/ledger-browser", "@mc-wallet/wallet-ui"],
};

/**
 * Audited development-only source that may depend on development packages.
 */
export const DEVELOPMENT_SOURCE_FILES = new Set(["apps/terminal/src/data/extended/dev-bridge.ts"]);

/**
 * Exact computed module-load allowances required by build and test adapters.
 */
export const NON_LITERAL_MODULE_LOADS = new Map<string, number>([
  ["packages/presentation/wallet-ui/tests/support/groups-harness.ts", 1],
  ["scripts/check-krusty-adapter.ts", 1],
  ["scripts/check-privacy-sdk.ts", 1],
]);

/**
 * Generated or external directories excluded from workspace source analysis.
 *
 * `.playwright-cli` holds the browser-trace cache a local Playwright session
 * writes; it is git-ignored, is already skipped by the file-standards and lint
 * gates, and its captured page scripts are not workspace source. Scanning it
 * made this gate fail on any machine that had ever driven the browser locally.
 * `.dev-profile` is the same story for `bun run dev:session`: a git-ignored
 * Chrome profile full of caches and singleton symlinks, never workspace source.
 */
export const EXCLUDED_DIRECTORIES = new Set([
  ".dev-profile",
  ".git",
  ".playwright-cli",
  "artifacts",
  "dist",
  "node_modules",
  "output",
  "playwright-report",
  "storybook-static",
  "target",
  "test-results",
  "vendor",
]);
