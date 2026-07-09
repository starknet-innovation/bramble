/**
 * Light wallet skin. The dark `midnight` skin is the default build; this is
 * the light alternate selected through the theme preference. Cool porcelain
 * surfaces with a deep emerald signal color and up/down semantics. Contrasts
 * meet WCAG AA on their ground.
 *
 * The three `--mc-aurora-*` hues drive the ambient depth layer behind the
 * Liquid Glass panels (see ../sidepanel/styles-aurora.ts): a bright, airy
 * mint → periwinkle → aqua wash so the frosted surfaces read as sunlit glass.
 * They are background light, not foreground ink — never used for text — and the
 * aurora layer keeps them soft so text over the glass stays legible.
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
    "--mc-aurora-1": "#38d3a0",
    "--mc-aurora-2": "#8aa6ff",
    "--mc-aurora-3": "#53d8d1",
    "--mc-bg": "#eef1f6",
    "--mc-border": "#e2e6ec",
    "--mc-danger": "#c23434",
    "--mc-elevated": "#eceff3",
    "--mc-muted": "#5f6772",
    "--mc-panel": "#ffffff",
    "--mc-positive": "#0a7a4d",
    "--mc-text": "#12141a",
  },
};
