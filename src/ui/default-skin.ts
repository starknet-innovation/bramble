/**
 * Light wallet skin — the "Clean Mono" daylight theme. The dark `midnight`
 * skin is the default build; this is the light alternate selected through the
 * theme preference. Cool porcelain surfaces on a soft neutral background with a
 * single deep-emerald accent and dedicated up/down semantics for gains and
 * losses. Quiet-luxury minimalism — flat and legible, not glass.
 *
 * Surfaces step in three quiet tiers: `--mc-sunken` for recessed group
 * containers, `--mc-panel` (pure white) for cards, and `--mc-elevated` for
 * controls and rows. Separation is carried by hairline edges and gentle low
 * shadows. Contrasts meet WCAG AA on their ground.
 */
import type { Skin } from "./skin";

/**
 * Built-in light skin used when the theme preference selects light mode.
 */
export const defaultSkin: Skin = {
  name: "daylight",
  tokens: {
    "--mc-accent": "#0a7a4d",
    "--mc-accent-text": "#ffffff",
    "--mc-bg": "#f4f6f8",
    "--mc-border": "#e2e6ec",
    "--mc-danger": "#c23434",
    "--mc-elevated": "#eef1f4",
    "--mc-muted": "#5f6772",
    "--mc-panel": "#ffffff",
    "--mc-positive": "#0a7a4d",
    "--mc-sunken": "#f0f2f5",
    "--mc-text": "#12141a",
  },
};
