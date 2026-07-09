/**
 * Default wallet skin — a premium near-black theme: deep ink background, two
 * lifted surfaces, a fresh emerald signal color, and dedicated up/down
 * semantics for gains and losses. All contrasts meet WCAG AA on their ground.
 *
 * The three `--mc-aurora-*` hues drive the ambient depth layer behind the
 * Liquid Glass panels (see ../sidepanel/styles-aurora.ts): a vivid emerald →
 * warm orchid → periwinkle spread. The orchid is a deliberate WARM second
 * accent so the aurora reads as luminous frosted glass rather than an all-green
 * wash, and the periwinkle breaks the green-teal monotony while staying tasteful
 * — not garish. The hues are saturated and bright because they must punch
 * through the deep-ink background to make the glass look lit. They are
 * background light, not foreground ink, so they never carry text and are held
 * below full opacity by the aurora layer.
 *
 * The two lifted surfaces (`--mc-panel`, `--mc-elevated`) sit a notch brighter
 * than a pure near-black so the frosted glass fill (a translucent tint of the
 * panel over the aurora) reads as clean lit glass, never a murky green-black.
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
    "--mc-aurora-1": "#1fe0a0",
    "--mc-aurora-2": "#c95cf0",
    "--mc-aurora-3": "#5b7bf5",
    "--mc-bg": "#0b0d10",
    "--mc-border": "#2b2f3a",
    "--mc-danger": "#ff6b6b",
    "--mc-elevated": "#20242e",
    "--mc-muted": "#96a0b0",
    "--mc-panel": "#191d26",
    "--mc-positive": "#2fcf8e",
    "--mc-text": "#f4f6fb",
  },
};
