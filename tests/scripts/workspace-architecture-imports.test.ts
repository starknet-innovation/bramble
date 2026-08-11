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
      ]),
    );
    expect(result.nonLiteralModuleLoads).toBe(0);
  });

  test("flags computed module loads and sibling-prefix path escapes", () => {
    const result = sourceImports("fixture.ts", "import(moduleName); require(...parts);");
    const root = resolve("fixture/workspace");

    expect(result.nonLiteralModuleLoads).toBe(2);
    expect(isOutsideRoot(root, join(root, "src", "module.ts"))).toBe(false);
    expect(isOutsideRoot(root, resolve(root, "..", "workspace-sibling", "module.ts"))).toBe(true);
  });
});
