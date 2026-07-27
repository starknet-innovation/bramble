/**
 * Light wallet skin — the "Clean Mono" daylight theme. The dark `midnight`
 * skin is the default build; this is the light alternate selected through the
 * theme preference. Every structural and interactive role is achromatic:
 * hierarchy comes from contrast, weight, space, and motion rather than a brand
 * hue. Green is reserved for positive/success semantics and red for
 * danger/failure. Quiet-luxury minimalism — flat and legible, not glass.
 *
 * Surfaces step in three quiet tiers: `--mc-sunken` for recessed group
 * containers, `--mc-panel` (pure white) for cards, and `--mc-elevated` for
 * controls and rows. Separation is carried by hairline edges and gentle low
 * shadows. Every text/ground pairing is guarded by the contrast test suite.
 */
import type { Skin } from "./skin";

/**
 * Built-in light skin used when the theme preference selects light mode.
 */
export const defaultSkin: Skin = {
  name: "daylight",
  tokens: {
    "--mc-accent": "#171717",
    "--mc-accent-text": "#fafafa",
    "--mc-bg": "#f5f5f5",
    "--mc-border": "#dedede",
    "--mc-danger": "#b4232c",
    "--mc-elevated": "#ececec",
    "--mc-muted": "#666666",
    "--mc-panel": "#ffffff",
    "--mc-positive": "#087a4b",
    "--mc-sunken": "#f0f0f0",
    "--mc-text": "#171717",
  },
};
