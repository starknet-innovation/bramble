/**
 * Default wallet skin — a premium near-black theme: deep ink background, two
 * lifted surfaces, a fresh emerald signal color, and dedicated up/down
 * semantics for gains and losses. All contrasts meet WCAG AA on their ground.
 *
 * The three `--mc-aurora-*` hues drive the ambient depth layer behind the
 * Liquid Glass panels (see ../sidepanel/styles-aurora.ts): a moody emerald →
 * indigo → cyan spread that gives the frosted surfaces colour and light to
 * refract. They are background light, not foreground ink, so they never carry
 * text and are held well below full opacity by the aurora layer.
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
    "--mc-aurora-1": "#17c088",
    "--mc-aurora-2": "#5a5cf0",
    "--mc-aurora-3": "#12b5cf",
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
