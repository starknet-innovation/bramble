/**
 * The repository's 500-line rule (AGENTS.md) for the swap screen. The shared
 * file-standards check excludes apps/terminal, so without this nothing caught
 * SwapPanel.tsx crossing it (rest audit L2).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SWAP_SCREEN = join(__dirname, "../src/screens/swap");

describe("swap screen files", () => {
  it("each stays under 500 lines", () => {
    const over = readdirSync(SWAP_SCREEN)
      .filter((name) => /\.tsx?$/.test(name))
      .map((name) => [name, readFileSync(join(SWAP_SCREEN, name), "utf8").trimEnd().split("\n").length] as const)
      .filter(([, lines]) => lines > 500);
    expect(over).toEqual([]);
  });
});
