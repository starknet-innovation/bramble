/**
 * Default wallet skin — a premium near-black theme: deep ink background, two
 * lifted surfaces, a fresh emerald signal color, and dedicated up/down
 * semantics for gains and losses. All contrasts meet WCAG AA on their ground.
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
    "--mc-border": "#23262e",
    "--mc-danger": "#ff6b6b",
    "--mc-elevated": "#181b21",
    "--mc-muted": "#8b95a5",
    "--mc-panel": "#14161b",
    "--mc-positive": "#2fcf8e",
    "--mc-text": "#f4f6fb",
  },
};
