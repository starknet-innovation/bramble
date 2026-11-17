/**
 * Remote feature flags must never reach a security decision: signing, key
 * derivation, RPC endpoints, contract addresses, fee ceilings, permission
 * checks, or privacy-pool parameters. A signed flag document is still remote
 * input; if its publisher key leaks, the blast radius must stay "a shipped
 * feature is hidden", never "what the user signs changes".
 *
 * Enforced structurally, deny-by-default: every shipped source file that
 * imports flag code (the `@bramble/flags` package or the background
 * `flags/` folder) or touches the router's `featureFlags` collaborator must be
 * on the short allowlist below. The protected decision paths are named
 * explicitly so a failure says which rule was broken, and the flags package
 * itself may depend on nothing that could make such a decision.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { sourceImports } from "../../scripts/workspace-architecture-imports";
import { REPO_DIR, repoRelative, workspaceSourceFiles } from "../support/workspace-sources";

const FLAGS_PACKAGE_SRC = "packages/features/flags/src/";
const BACKGROUND_FLAGS = "apps/extension/src/background/flags/";

// The only shipped files allowed to see flag code outside the flag modules
// themselves. Each is wiring or a type union; none decides anything except
// the side panel's reader, whose values decide only what the panel shows
// (`shared/feature-gates.ts` hides gated elements and screens).
const ALLOWED_IMPORTERS = new Set([
  "apps/extension/src/background/index.ts",
  "apps/extension/src/background/routing/message-context.ts",
  "apps/extension/src/background/routing/messages.ts",
  "apps/extension/src/background/runtime/runtime-types.ts",
  "packages/presentation/wallet-ui/src/sidepanel/runtime/runtime-feature-flags.ts",
]);

// Security decision paths, named so a violation reads as the rule it breaks.
const PROTECTED_PATHS = [
  "apps/extension/src/background/accounts/",
  "apps/extension/src/background/approvals/",
  "apps/extension/src/background/ledger/",
  "apps/extension/src/background/multisig/",
  "apps/extension/src/background/onboarding/",
  "apps/extension/src/background/privacy/",
  "apps/extension/src/background/provider/",
  "apps/extension/src/background/runtime/session",
  "apps/extension/src/background/runtime/runtime-rpc",
  "apps/extension/src/background/transactions/",
  "packages/features/multisig/",
  "packages/features/permissions/",
  "packages/features/privacy/",
  "packages/features/transactions/",
  "packages/foundation/wallet-model/",
  "packages/platform/kms-krusty/",
  "packages/platform/ledger-browser/",
  "packages/platform/ledger-protocol/",
  "packages/platform/starknet/",
  "packages/platform/vault/",
];

const isFlagModule = (file: string): boolean =>
  file.startsWith(FLAGS_PACKAGE_SRC) || file.startsWith(BACKGROUND_FLAGS);

const importsFlagCode = (absolute: string, source: string): boolean =>
  sourceImports(absolute, source).specifiers.some((specifier) => {
    if (specifier === "@bramble/flags" || specifier.startsWith("@bramble/flags/")) {
      return true;
    }
    if (!specifier.startsWith(".")) {
      return false;
    }
    const target = repoRelative(resolve(dirname(absolute), specifier));
    return isFlagModule(target) || isFlagModule(`${target}/`);
  });

const flagTouchingFiles = (): readonly string[] =>
  workspaceSourceFiles()
    .map((absolute) => ({ absolute, file: repoRelative(absolute) }))
    .filter(({ file }) => !isFlagModule(file))
    .filter(({ absolute }) => {
      const source = readFileSync(absolute, "utf8");
      return importsFlagCode(absolute, source) || /\bfeatureFlags\b/.test(source);
    })
    .map(({ file }) => file)
    .sort();

describe("feature-flag isolation", () => {
  test("only the allowlisted wiring files import or reference flag code", () => {
    expect(flagTouchingFiles().filter((file) => !ALLOWED_IMPORTERS.has(file))).toEqual([]);
  });

  test("no security decision path imports or references flag code", () => {
    const violations = flagTouchingFiles().filter((file) =>
      PROTECTED_PATHS.some((path) => file.startsWith(path)),
    );
    expect(violations).toEqual([]);
  });

  test("the allowlist is live (every entry still wires flags)", () => {
    expect(flagTouchingFiles()).toEqual([...ALLOWED_IMPORTERS].sort());
  });

  test("the flags package depends on nothing that can make a security decision", () => {
    const manifest = JSON.parse(
      readFileSync(join(REPO_DIR, "packages/features/flags/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      "@bramble/core",
      "@bramble/store",
    ]);
  });

  test("flags package sources import only core, store, and each other", () => {
    const allowed = /^(@bramble\/(core|store)\/|\.\/)/;
    const offenders = workspaceSourceFiles()
      .filter((absolute) => repoRelative(absolute).startsWith(FLAGS_PACKAGE_SRC))
      .flatMap((absolute) =>
        sourceImports(absolute, readFileSync(absolute, "utf8"))
          .specifiers.filter((specifier) => !allowed.test(specifier))
          .map((specifier) => `${repoRelative(absolute)} -> ${specifier}`),
      );
    expect(offenders).toEqual([]);
  });
});
