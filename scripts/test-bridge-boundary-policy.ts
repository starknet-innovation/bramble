/**
 * Shipped code must never reach test-only tooling (issue 861). The Speculos
 * Ledger bridge under `tests/e2e/ledger/` fakes a hardware device, and
 * `tools/vendor-dataset/` derives test keys; either inside `apps/` or
 * `packages/` would put a test double, or key derivation, in the extension.
 * Pure rules, unit-tested in `tests/scripts/test-bridge-boundary.test.ts`;
 * `check-test-bridge-boundary.ts` applies them to every source file.
 */
import { dirname, relative, resolve, sep } from "node:path";

/** Repository-relative roots no shipped source may import or name. */
export const TEST_ONLY_ROOTS = ["tests/e2e/ledger", "tools/vendor-dataset"] as const;

/** Roots whose files are shipped or shared with shipped code. */
export const SHIPPED_ROOTS = ["apps", "packages"] as const;

const posix = (path: string): string => path.split(sep).join("/");

const insideTestOnlyRoot = (repositoryPath: string): string | undefined =>
  TEST_ONLY_ROOTS.find((root) => repositoryPath === root || repositoryPath.startsWith(`${root}/`));

/**
 * Failures for one shipped file: a relative or absolute import that resolves
 * into a test-only root, or any mention of a test-only root's path in its text
 * (which also catches computed imports, bundler entries and HTML script tags).
 * `file` is repository-relative; `repositoryRoot` is absolute.
 */
export const testBridgeBoundaryFailures = (input: {
  readonly file: string;
  readonly repositoryRoot: string;
  readonly specifiers: readonly string[];
  readonly text: string;
}): readonly string[] => {
  const failures: string[] = [];
  for (const specifier of input.specifiers) {
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      continue;
    }
    const target = posix(
      relative(input.repositoryRoot, resolve(input.repositoryRoot, dirname(input.file), specifier)),
    );
    const root = insideTestOnlyRoot(target);
    if (root) {
      failures.push(`${input.file} imports test-only ${root} via ${specifier}`);
    }
  }
  for (const root of TEST_ONLY_ROOTS) {
    if (input.text.includes(root)) {
      failures.push(`${input.file} names test-only ${root}`);
    }
  }
  return failures;
};
