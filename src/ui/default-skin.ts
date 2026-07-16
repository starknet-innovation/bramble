/**
 * Light wallet skin — the "Clean Mono" daylight theme. The dark `midnight`
 * skin is the default build; this is the light alternate selected through the
 * theme preference. Cool porcelain surfaces on a soft neutral background with
 * a single deep-cobalt accent and dedicated market semantics — green strictly
 * for gains and success, red for losses and danger — so the brand colour never
 * masquerades as a market signal. Quiet-luxury minimalism — flat and legible,
 * not glass.
 *
 * Surfaces step in three quiet tiers: `--mc-sunken` for recessed group
 * containers, `--mc-panel` (pure white) for cards, and `--mc-elevated` for
 * controls and rows. Separation is carried by hairline edges and gentle low
 * shadows. Contrasts meet WCAG AA on their ground (accent 6.0:1 on white,
 * muted 5.2:1 on elevated).
 */
import type { Skin } from "./skin";

/**
 * Built-in light skin used when the theme preference selects light mode.
 */
export const defaultSkin: Skin = {
  name: "daylight",
  tokens: {
    "--mc-accent": "#1f57e0",
    "--mc-accent-text": "#ffffff",
    "--mc-bg": "#f4f6f9",
    "--mc-border": "#e2e6ee",
    "--mc-danger": "#c23434",
    "--mc-elevated": "#eceff5",
    "--mc-muted": "#5a6474",
    "--mc-panel": "#ffffff",
    "--mc-positive": "#0a7a4d",
    "--mc-sunken": "#eff1f6",
    "--mc-text": "#131722",
  },
};
