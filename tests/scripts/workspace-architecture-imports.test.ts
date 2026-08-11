/** Regression tests for the workspace architecture module scanner. */
import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { isOutsideRoot, sourceImports } from "../../scripts/workspace-architecture-imports";

describe("workspace architecture import analysis", () => {
  test("finds every literal module-reference form", () => {
    const result = sourceImports(
      "fixture.ts",
      `
        import "side-effect";
        import type { Account } from "@mc-wallet/wallet-model/accounts";
        export { value } from "./value";
        type Call = import("starknet").Call;
        void import("@mc-wallet/vault/service");
        require("legacy-module");
        require.resolve("resolved-module");
        module.require("module-require");
        import assigned = require("assigned-module");
      `,
    );

    expect(new Set(result.specifiers)).toEqual(
      new Set([
        "side-effect",
        "@mc-wallet/wallet-model/accounts",
        "./value",
        "starknet",
        "@mc-wallet/vault/service",
        "legacy-module",
        "resolved-module",
        "module-require",
        "assigned-module",
      ]),
    );
    expect(result.nonLiteralModuleLoads).toBe(0);
  });

  test("flags computed module loads and sibling-prefix path escapes", () => {
    const result = sourceImports(
      "fixture.ts",
      "import(moduleName); require(...parts); require.resolve(packageName);",
    );
    const root = resolve("fixture/workspace");

    expect(result.nonLiteralModuleLoads).toBe(3);
    expect(isOutsideRoot(root, join(root, "src", "module.ts"))).toBe(false);
    expect(isOutsideRoot(root, resolve(root, "..", "workspace-sibling", "module.ts"))).toBe(true);
  });

  test("parses JavaScript module variants", () => {
    expect(sourceImports("fixture.jsx", 'export { value } from "declared-package";')).toEqual({
      nonLiteralModuleLoads: 0,
      specifiers: ["declared-package"],
    });
    expect(sourceImports("fixture.mjs", "import(packageName);").nonLiteralModuleLoads).toBe(1);
  });
});
