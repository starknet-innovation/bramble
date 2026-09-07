/**
 * Light wallet skin — the "Clean Mono" daylight theme. The dark `midnight`
 * skin is the default build; this is the light alternate selected through the
 * theme preference. Every structural and interactive role is achromatic:
 * hierarchy comes from contrast, weight, space, and motion rather than a brand
 * hue. Green is reserved for positive/success semantics and red for
 * danger/failure; orange is reserved for degraded data. Quiet-luxury minimalism — flat and legible, not glass.
 *
 * Surfaces step in three quiet tiers: `--bramble-sunken` for recessed group
 * containers, `--bramble-panel` (pure white) for cards, and `--bramble-elevated` for
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
    "--bramble-accent": "#171717",
    "--bramble-accent-text": "#fafafa",
    "--bramble-account-avatar-0": "#6842a8",
    "--bramble-account-avatar-1": "#e27a35",
    "--bramble-account-avatar-2": "#e9b83f",
    "--bramble-account-avatar-3": "#9f356f",
    "--bramble-account-avatar-ink": "#171717",
    "--bramble-account-avatar-paper": "#fafafa",
    "--bramble-bg": "#f5f5f5",
    "--bramble-border": "#dedede",
    "--bramble-danger": "#b4232c",
    "--bramble-elevated": "#ececec",
    "--bramble-muted": "#666666",
    "--bramble-panel": "#ffffff",
    "--bramble-positive": "#087a4b",
    "--bramble-sunken": "#f0f0f0",
    "--bramble-text": "#171717",
    "--bramble-warning": "#9a3412",
  },
};
