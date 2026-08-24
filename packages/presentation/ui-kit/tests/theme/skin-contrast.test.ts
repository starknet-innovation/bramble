/**
 * WCAG 2.x contrast gate for the two designed skins. Every ink/ground pair the
 * UI actually renders text on must meet AA for normal text (≥ 4.5:1) — the
 * palette is designed so inks stay compliant on every surface tier (bg,
 * panel, elevated, sunken), so a token can move between tiers without a
 * contrast audit. The derived soft fills (accent-soft, danger-soft — see
 * styles-base.ts) are reproduced here with the same srgb mix the stylesheet
 * uses, so their ink pairings are gated too.
 */
import { describe, expect, test } from "bun:test";
import { darkSkin } from "@mc-wallet/ui-kit/dark-skin";
import { defaultSkin } from "@mc-wallet/ui-kit/default-skin";
import type { Skin, SkinToken } from "@mc-wallet/ui-kit/skin";

const AA_NORMAL_TEXT = 4.5;

type Rgb = readonly [number, number, number];

const hexToRgb = (hex: string): Rgb => {
  const value = hex.replace("#", "");
  expect(value).toMatch(/^[0-9a-fA-F]{6}$/);
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
};

const channelLuminance = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = ([r, g, b]: Rgb): number =>
  0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);

const contrast = (foreground: Rgb, background: Rgb): number => {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
};

// Mirrors `color-mix(in srgb, A <percent>%, B)` for opaque hex colors.
const mixSrgb = (a: Rgb, percent: number, b: Rgb): Rgb => {
  const p = percent / 100;
  return [
    Math.round(a[0] * p + b[0] * (1 - p)),
    Math.round(a[1] * p + b[1] * (1 - p)),
    Math.round(a[2] * p + b[2] * (1 - p)),
  ];
};

const token = (skin: Skin, name: SkinToken): Rgb => hexToRgb(skin.tokens[name]);

const INKS: readonly SkinToken[] = [
  "--mc-text",
  "--mc-muted",
  "--mc-accent",
  "--mc-positive",
  "--mc-danger",
  "--mc-warning",
];
const GROUNDS: readonly SkinToken[] = ["--mc-bg", "--mc-panel", "--mc-elevated", "--mc-sunken"];
const ACHROMATIC_TOKENS: readonly SkinToken[] = [
  "--mc-accent",
  "--mc-accent-text",
  "--mc-bg",
  "--mc-border",
  "--mc-elevated",
  "--mc-muted",
  "--mc-panel",
  "--mc-sunken",
  "--mc-text",
];
const LIGHT_AVATAR_TONES: readonly SkinToken[] = ["--mc-account-avatar-0", "--mc-account-avatar-3"];
const DARK_AVATAR_TONES: readonly SkinToken[] = ["--mc-account-avatar-1", "--mc-account-avatar-2"];

describe.each([
  ["midnight", darkSkin],
  ["daylight", defaultSkin],
])("%s skin contrast", (_name, skin) => {
  test("every ink meets AA on every surface tier", () => {
    for (const ink of INKS) {
      for (const ground of GROUNDS) {
        const ratio = contrast(token(skin, ink), token(skin, ground));
        expect(
          ratio,
          `${ink} on ${ground} is ${ratio.toFixed(2)}:1 (needs ${AA_NORMAL_TEXT}:1)`,
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      }
    }
  });

  test("the CTA label meets AA on the accent fill", () => {
    const ratio = contrast(token(skin, "--mc-accent-text"), token(skin, "--mc-accent"));
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  test("the badge ink (page ground) meets AA on the danger fill", () => {
    const ratio = contrast(token(skin, "--mc-bg"), token(skin, "--mc-danger"));
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  test("account character features keep non-text contrast against every identity tone", () => {
    for (const ground of LIGHT_AVATAR_TONES) {
      expect(
        contrast(token(skin, "--mc-account-avatar-paper"), token(skin, ground)),
      ).toBeGreaterThanOrEqual(3);
    }
    for (const ground of DARK_AVATAR_TONES) {
      expect(
        contrast(token(skin, "--mc-account-avatar-ink"), token(skin, ground)),
      ).toBeGreaterThanOrEqual(3);
    }
  });

  test("accent and danger inks meet AA on their derived soft fills", () => {
    // Percentages must match the --mc-accent-soft / --mc-danger-soft
    // definitions in styles-base.ts.
    const accentSoft = mixSrgb(token(skin, "--mc-accent"), 13, token(skin, "--mc-panel"));
    const dangerSoft = mixSrgb(token(skin, "--mc-danger"), 12, token(skin, "--mc-panel"));
    expect(contrast(token(skin, "--mc-accent"), accentSoft)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrast(token(skin, "--mc-danger"), dangerSoft)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  test("interaction and structural roles are strictly achromatic", () => {
    for (const name of ACHROMATIC_TOKENS) {
      const [red, green, blue] = token(skin, name);
      expect(red, `${name} must not carry a hue`).toBe(green);
      expect(green, `${name} must not carry a hue`).toBe(blue);
    }
  });

  test("green, orange, and red remain reserved semantic signals", () => {
    const [positiveRed, positiveGreen, positiveBlue] = token(skin, "--mc-positive");
    const [dangerRed, dangerGreen, dangerBlue] = token(skin, "--mc-danger");
    const [warningRed, warningGreen, warningBlue] = token(skin, "--mc-warning");
    expect(positiveGreen).toBeGreaterThan(positiveRed);
    expect(positiveGreen).toBeGreaterThan(positiveBlue);
    expect(dangerRed).toBeGreaterThan(dangerGreen);
    expect(dangerRed).toBeGreaterThan(dangerBlue);
    expect(warningRed).toBeGreaterThan(warningGreen);
    expect(warningGreen).toBeGreaterThan(warningBlue);
    expect(skin.tokens["--mc-accent"]).not.toBe(skin.tokens["--mc-positive"]);
    expect(skin.tokens["--mc-accent"]).not.toBe(skin.tokens["--mc-danger"]);
    expect(skin.tokens["--mc-accent"]).not.toBe(skin.tokens["--mc-warning"]);
  });
});
