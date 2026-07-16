/**
 * System skin checks: the default "system" theme sources its neutrals from CSS
 * system-color keywords (so they match the browser and auto-flip with
 * `color-scheme`) while keeping the cobalt brand accent and up/down market
 * semantics as fixed `light-dark()` values rather than system colors.
 */
import { expect, test } from "bun:test";

import { applySkin } from "../src/ui/skin";
import { systemSkin } from "../src/ui/system-skin";

test("system skin neutrals are CSS system-color keywords", () => {
  expect(systemSkin.name).toBe("system");
  expect(systemSkin.tokens["--mc-bg"]).toBe("Canvas");
  expect(systemSkin.tokens["--mc-panel"]).toBe("Canvas");
  expect(systemSkin.tokens["--mc-sunken"]).toBe("Canvas");
  expect(systemSkin.tokens["--mc-elevated"]).toBe("ButtonFace");
  expect(systemSkin.tokens["--mc-text"]).toBe("CanvasText");
  expect(systemSkin.tokens["--mc-muted"]).toBe("GrayText");
});

test("system skin border is a CanvasText-derived hairline, not a raw color", () => {
  const border = systemSkin.tokens["--mc-border"];
  expect(border).toContain("color-mix(");
  expect(border).toContain("CanvasText");
  expect(border).toContain("transparent");
});

test("system skin keeps the cobalt brand accent as fixed light-dark values", () => {
  // Accent, accent-on-text, and the up/down semantics stay designed tokens —
  // Chrome does not expose the browser accent to an extension page — resolved
  // per ground by light-dark() so contrast holds in both schemes.
  for (const token of [
    "--mc-accent",
    "--mc-accent-text",
    "--mc-positive",
    "--mc-danger",
  ] as const) {
    expect(systemSkin.tokens[token]).toMatch(/^light-dark\(.+,.+\)$/);
  }
  // The cobalt pair is the daylight/midnight brand blue, deep on light and
  // bright on dark; the market-positive green stays its own semantic token so
  // brand and gains never share one colour.
  expect(systemSkin.tokens["--mc-accent"]).toBe("light-dark(#1f57e0, #5c8dff)");
  expect(systemSkin.tokens["--mc-positive"]).toBe("light-dark(#0a7a4d, #2fcf8e)");
  expect(systemSkin.tokens["--mc-accent"]).not.toBe(systemSkin.tokens["--mc-positive"]);
});

test("system skin satisfies the skin contract and applies every token", () => {
  const applied: Record<string, string> = {};
  const root = {
    style: {
      setProperty(token: string, value: string) {
        applied[token] = value;
      },
    },
  } as unknown as HTMLElement;

  applySkin(systemSkin, root);

  expect(applied).toEqual(systemSkin.tokens);
});
