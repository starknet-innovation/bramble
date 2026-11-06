/**
 * Shipped code may not import or name the Speculos Ledger bridge or the
 * vendor-dataset tooling (issue 861, review point 3).
 */
import { describe, expect, test } from "bun:test";
import { testBridgeBoundaryFailures } from "../../scripts/test-bridge-boundary-policy";

const repositoryRoot = "/repo";
const check = (file: string, specifiers: readonly string[], text = "") =>
  testBridgeBoundaryFailures({ file, repositoryRoot, specifiers, text });

describe("test bridge boundary", () => {
  test("refuses a relative import of the bridge from a package", () => {
    expect(
      check("packages/platform/ledger-browser/src/transport.ts", [
        "../../../../tests/e2e/ledger/hid-bridge",
      ]),
    ).toEqual([
      "packages/platform/ledger-browser/src/transport.ts imports test-only tests/e2e/ledger via ../../../../tests/e2e/ledger/hid-bridge",
    ]);
  });

  test("refuses the vendor-dataset tooling from an app", () => {
    expect(
      check("apps/extension/src/x.ts", ["../../../tools/vendor-dataset/matrix-lib"]),
    ).toHaveLength(1);
  });

  test("refuses a mention in any text, such as a computed import or page", () => {
    expect(
      check("apps/extension/public/a.html", [], '<script src="/tests/e2e/ledger/x.js">'),
    ).toHaveLength(1);
  });

  test("allows ordinary imports, including look-alike names", () => {
    expect(
      check("packages/a/src/b.ts", [
        "./ledger",
        "@bramble/testkit/ledger-management",
        "../tests/e2e-ledger",
      ]),
    ).toEqual([]);
  });
});
