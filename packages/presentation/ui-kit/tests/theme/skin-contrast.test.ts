/**
 * WCAG 2.x contrast gate for the two designed skins. Every ink/ground pair the
 * UI actually renders text on must meet AA for normal text (≥ 4.5:1) — the
 * palette is designed so inks stay compliant on every surface tier (bg,
 * panel, elevated, sunken), so a token can move between tiers without a
 * contrast audit. The derived soft fills (accent-soft, danger-soft — see
 * styles-base.ts) are reproduced here with the same srgb mix the stylesheet
 * uses, so their ink pairings are gated too.
 *
 * Structural roles stay near-neutral in both skins — achromatic in the
 * midnight skin, the Bramble Design Kit's blue-grey tinted ramp in daylight —
 * never a saturated surface. The accent is either neutral ink (midnight) or
 * the kit's brand blue (daylight); green/orange/red stay reserved semantics.
 */
import { describe, expect, test } from "bun:test";
import { darkSkin } from "@bramble/ui-kit/dark-skin";
import { defaultSkin } from "@bramble/ui-kit/default-skin";
import type { Skin, SkinToken } from "@bramble/ui-kit/skin";

// WCAG 1.4.11: user-interface component boundaries.
const NON_TEXT_CONTRAST = 3;
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
  "--bramble-text",
  "--bramble-muted",
  "--bramble-accent",
  "--bramble-positive",
  "--bramble-danger",
  "--bramble-warning",
];
const GROUNDS: readonly SkinToken[] = [
  "--bramble-bg",
  "--bramble-panel",
  "--bramble-elevated",
  "--bramble-sunken",
];
const NEUTRAL_TOKENS: readonly SkinToken[] = [
  "--bramble-accent-text",
  "--bramble-bg",
  "--bramble-border",
  "--bramble-elevated",
  "--bramble-muted",
  "--bramble-panel",
  "--bramble-sunken",
  "--bramble-text",
];
// Widest channel spread a structural role may carry. The kit's tinted grey
// ramp peaks at 35 (grey/500); any step of its blue ramp is well over 100, so
// this catches a saturated surface or ink sneaking into a structural slot.
const NEUTRAL_MAX_SPREAD = 40;
const avatarTones = (role: string, count: number): readonly SkinToken[] =>
  Array.from(
    { length: count },
    (_, index) => `--bramble-account-avatar-${role}-${index}` as SkinToken,
  );
const AVATAR_GROUNDS = avatarTones("ground", 4);
const AVATAR_BODIES = avatarTones("body", 5);
const AVATAR_ACCENTS = avatarTones("accent", 4);

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

  // The field edge identifies a control (WCAG 1.4.11), so it needs non-text
  // contrast against every surface a field can sit on — not only the fill it is
  // drawn on, since a field's edge is read against the panel around it too.
  test("the field edge meets 3:1 non-text contrast on every surface tier", () => {
    for (const ground of GROUNDS) {
      const ratio = contrast(token(skin, "--bramble-border"), token(skin, ground));
      expect(
        ratio,
        `--bramble-border on ${ground} is ${ratio.toFixed(2)}:1 (needs ${NON_TEXT_CONTRAST}:1)`,
      ).toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);
    }
  });

  test("the CTA label meets AA on the accent fill", () => {
    const ratio = contrast(token(skin, "--bramble-accent-text"), token(skin, "--bramble-accent"));
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  test("the badge ink (page ground) meets AA on the danger fill", () => {
    const ratio = contrast(token(skin, "--bramble-bg"), token(skin, "--bramble-danger"));
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  // Any ground, body, and accent can meet in one bird, so every pairing is held
  // to non-text contrast: the body against its ground, the wing, crest, tail
  // and beak against the body, and the paper eye against the body.
  test("every account bird pairing keeps non-text contrast", () => {
    const pairs: [SkinToken, SkinToken][] = [
      ...AVATAR_BODIES.flatMap((body) =>
        AVATAR_GROUNDS.map((ground): [SkinToken, SkinToken] => [body, ground]),
      ),
      ...AVATAR_ACCENTS.flatMap((accent) =>
        AVATAR_BODIES.map((body): [SkinToken, SkinToken] => [accent, body]),
      ),
      ...AVATAR_BODIES.map((body): [SkinToken, SkinToken] => [
        "--bramble-account-avatar-paper",
        body,
      ]),
      ["--bramble-account-avatar-ink", "--bramble-account-avatar-paper"],
    ];
    for (const [ink, ground] of pairs) {
      const ratio = contrast(token(skin, ink), token(skin, ground));
      expect(
        ratio,
        `${ink} on ${ground} is ${ratio.toFixed(2)}:1 (needs 3:1)`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  test("accent and danger inks meet AA on their derived soft fills", () => {
    // Percentages must match the --bramble-accent-soft / --bramble-danger-soft
    // definitions in styles-base.ts.
    const accentSoft = mixSrgb(token(skin, "--bramble-accent"), 13, token(skin, "--bramble-panel"));
    const dangerSoft = mixSrgb(token(skin, "--bramble-danger"), 12, token(skin, "--bramble-panel"));
    expect(contrast(token(skin, "--bramble-accent"), accentSoft)).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
    expect(contrast(token(skin, "--bramble-danger"), dangerSoft)).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
  });

  test("structural roles stay on the tinted neutral ramp, never a saturated hue", () => {
    for (const name of NEUTRAL_TOKENS) {
      const channels = token(skin, name);
      const spread = Math.max(...channels) - Math.min(...channels);
      expect(spread, `${name} must stay near-neutral`).toBeLessThanOrEqual(NEUTRAL_MAX_SPREAD);
    }
  });

  test("the accent is neutral ink or the brand blue, never another hue", () => {
    const [red, green, blue] = token(skin, "--bramble-accent");
    const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
    if (spread > NEUTRAL_MAX_SPREAD) {
      expect(blue, "a hued accent must be the brand blue").toBeGreaterThan(red);
      expect(blue, "a hued accent must be the brand blue").toBeGreaterThan(green);
    }
  });

  test("green, orange, and red remain reserved semantic signals", () => {
    const [positiveRed, positiveGreen, positiveBlue] = token(skin, "--bramble-positive");
    const [dangerRed, dangerGreen, dangerBlue] = token(skin, "--bramble-danger");
    const [warningRed, warningGreen, warningBlue] = token(skin, "--bramble-warning");
    expect(positiveGreen).toBeGreaterThan(positiveRed);
    expect(positiveGreen).toBeGreaterThan(positiveBlue);
    expect(dangerRed).toBeGreaterThan(dangerGreen);
    expect(dangerRed).toBeGreaterThan(dangerBlue);
    expect(warningRed).toBeGreaterThan(warningGreen);
    expect(warningGreen).toBeGreaterThan(warningBlue);
    expect(skin.tokens["--bramble-accent"]).not.toBe(skin.tokens["--bramble-positive"]);
    expect(skin.tokens["--bramble-accent"]).not.toBe(skin.tokens["--bramble-danger"]);
    expect(skin.tokens["--bramble-accent"]).not.toBe(skin.tokens["--bramble-warning"]);
  });
});
