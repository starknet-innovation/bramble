/**
 * Spacing comes from the scale (#385): every padding and margin in the side
 * panel stylesheets is written in SPACE tokens (or derived from other scale
 * tokens), never a bare pixel value. Uneven, hand-typed insets are most of what
 * "things not aligned" turned out to mean, and a literal is how they come back.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SPACE } from "@bramble/ui-kit/tokens";

const STYLES = join(import.meta.dir, "../../../src/sidepanel/styles");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : [],
  );

// A padding or margin declaration (any side or logical axis) whose value types
// a pixel figure directly. `${SPACE.md}` and calc() over tokens do not match.
const LITERAL_SPACING = /\b(?:padding|margin)(?:-[a-z]+)*\s*:[^;{}]*?(?<![\w.-])-?\d+(?:\.\d+)?px/g;

describe("spacing tokens", () => {
  test("no padding or margin in the side-panel stylesheets is a literal pixel value", () => {
    const files = sources(STYLES);
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(LITERAL_SPACING)].map(
        (match) => `${file.slice(STYLES.length + 1)}: ${match[0].trim()}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  test("the scale stays on its 2px half step and 4px grid", () => {
    for (const value of Object.values(SPACE)) {
      const px = Number.parseFloat(value);
      expect(value as string).toBe(`${px}px`);
      expect(px === 2 || px % 4 === 0).toBe(true);
    }
  });
});
