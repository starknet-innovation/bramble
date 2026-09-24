/**
 * The iOS screens take elevation only from the generated per-component table
 * (`BrambleElevation`) through the design system's `elevation(_:)` modifier, so a shadow cannot
 * be re-tuned on one screen and drift from the extension (design-mobile.md 2.3). Screens and app
 * code may not name a `BrambleShadow` tier or call SwiftUI's `.shadow(` directly.
 */
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const IOS = "mobile/ios/Bramble";
const DESIGN_SYSTEM = `${IOS}/DesignSystem`;

const swiftFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return swiftFiles(path);
      return Promise.resolve(entry.name.endsWith(".swift") ? [path] : []);
    }),
  );
  return nested.flat();
};

describe("mobile elevation usage", () => {
  test("no screen names a shadow tier or draws its own shadow", async () => {
    const offenders: string[] = [];
    for (const path of await swiftFiles(IOS)) {
      if (path.startsWith(DESIGN_SYSTEM)) continue;
      const source = await readFile(path, "utf8");
      if (/BrambleShadow\.|\bshadow\(|brambleShadow\(/.test(source)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  test("inside the design system only the elevation modifier draws a shadow", async () => {
    const drawn: string[] = [];
    for (const path of await swiftFiles(DESIGN_SYSTEM)) {
      if (path.endsWith(".generated.swift")) continue;
      const source = await readFile(path, "utf8");
      if (/\bshadow\(/.test(source)) drawn.push(path);
    }
    expect(drawn).toEqual([`${DESIGN_SYSTEM}/BrambleTheme.swift`]);
  });
});
