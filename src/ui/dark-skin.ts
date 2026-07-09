/**
 * Default wallet skin — the "Clean Mono" midnight theme: a near-monochrome
 * neutral palette on a deep near-black background, with a single restrained
 * emerald accent used only where it earns attention (primary CTA, active
 * states, positive deltas). Quiet-luxury minimalism — flat and legible, not
 * glass.
 *
 * Surfaces step in three quiet tiers over the background: `--mc-sunken` for
 * recessed group containers (tab tracks, permission/sign panels), `--mc-panel`
 * for cards, and `--mc-elevated` for controls and rows. The steps are subtle;
 * separation is carried by hairline edges and gentle low shadows, so the whole
 * panel reads as calm layered paper rather than lit material. All contrasts
 * meet WCAG AA on their ground.
 */
import type { Skin } from "./skin";

/**
 * Built-in dark skin used by the default extension build.
 */
export const darkSkin: Skin = {
  name: "midnight",
  tokens: {
    "--mc-accent": "#2fcf8e",
    "--mc-accent-text": "#04150d",
    "--mc-bg": "#0b0d10",
    "--mc-border": "#22252d",
    "--mc-danger": "#ff6b6b",
    "--mc-elevated": "#1a1d23",
    "--mc-muted": "#8b95a5",
    "--mc-panel": "#131519",
    "--mc-positive": "#2fcf8e",
    "--mc-sunken": "#0e1013",
    "--mc-text": "#f4f6fb",
  },
};
