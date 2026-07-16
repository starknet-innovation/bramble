/**
 * Default wallet skin — the "Clean Mono" midnight theme: a near-monochrome
 * cool-slate palette on a deep near-black background, with a single restrained
 * cobalt accent used only where it earns attention (primary CTA, active
 * states, focus) and dedicated market semantics — green strictly for gains and
 * success, red for losses and danger — so the brand colour never masquerades
 * as a market signal. Quiet-luxury minimalism — flat and legible, not glass.
 *
 * Surfaces step in three quiet tiers over the background: `--mc-sunken` for
 * recessed group containers (tab tracks, permission/sign panels), `--mc-panel`
 * for cards, and `--mc-elevated` for controls and rows. The steps are subtle;
 * separation is carried by hairline edges and gentle low shadows, so the whole
 * panel reads as calm layered paper rather than lit material. All contrasts
 * meet WCAG AA on their ground (accent 5.8:1+ on panel, muted 6.3:1 on
 * elevated, accent-text 5.9:1 on the accent fill).
 */
import type { Skin } from "./skin";

/**
 * Built-in dark skin used by the default extension build.
 */
export const darkSkin: Skin = {
  name: "midnight",
  tokens: {
    "--mc-accent": "#5c8dff",
    "--mc-accent-text": "#0a1220",
    "--mc-bg": "#0b0e13",
    "--mc-border": "#232833",
    "--mc-danger": "#f87171",
    "--mc-elevated": "#1a1e26",
    "--mc-muted": "#94a0b3",
    "--mc-panel": "#12151b",
    "--mc-positive": "#2fcf8e",
    "--mc-sunken": "#0e1117",
    "--mc-text": "#f2f5fa",
  },
};
