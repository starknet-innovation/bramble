/**
 * Light wallet skin. The dark `midnight` skin is the default build; this is
 * the light alternate selected through the theme preference. Cool porcelain
 * surfaces with a deep emerald signal color and up/down semantics. Contrasts
 * meet WCAG AA on their ground.
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
    "--mc-elevated": "#eceff3",
    "--mc-muted": "#5f6772",
    "--mc-panel": "#ffffff",
    "--mc-positive": "#0a7a4d",
    "--mc-text": "#12141a",
  },
};
