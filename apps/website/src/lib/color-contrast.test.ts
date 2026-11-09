/** Keeps website text and form controls readable against every flat brand surface. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");
const color = (name: string): string => {
  const value = css.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))?.[1];
  if (!value) throw new Error(`Missing opaque color token: ${name}`);
  return value;
};
const luminance = (hex: string): number => {
  const linear = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
};
const contrast = (a: string, b: string): number => {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};

test("normal and secondary copy meet 4.5:1 on every page surface", () => {
  for (const surface of ["background", "honey", "blossom", "lavender", "sage"]) {
    for (const text of ["foreground", "muted-foreground"]) {
      expect(contrast(color(text), color(surface))).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("primary and disabled button labels stay readable", () => {
  expect(contrast(color("background"), color("primary"))).toBeGreaterThanOrEqual(7);
  expect(contrast(color("muted-foreground"), color("disabled-background"))).toBeGreaterThanOrEqual(
    4.5,
  );
});

test("field boundaries contrast with both the field and its white card", () => {
  expect(contrast(color("control-border"), color("background"))).toBeGreaterThanOrEqual(3);
  expect(contrast(color("control-border"), "#ffffff")).toBeGreaterThanOrEqual(3);
});

test("landscape copy contrasts even against a white pixel under the uniform tint", () => {
  const home = readFileSync(new URL("../styles/home.css", import.meta.url), "utf8");
  const tint = home.match(/background: (#[0-9a-f]{6}) url/)?.[1];
  expect(home).toContain("background-blend-mode: multiply");
  if (!tint) throw new Error("Missing landscape tint");
  expect(contrast(color("background"), tint)).toBeGreaterThanOrEqual(4.5);
});
