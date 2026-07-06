/**
 * Default compact wallet skin. Replace this import to swap the UI skin.
 */
import type { Skin } from "./skin";

/**
 * Built-in popup skin used by the default extension build.
 */
export const defaultSkin: Skin = {
  name: "default",
  tokens: {
    "--mc-accent": "#2f6fed",
    "--mc-accent-text": "#ffffff",
    "--mc-bg": "#f7f8fa",
    "--mc-border": "#d7dce3",
    "--mc-danger": "#b42318",
    "--mc-muted": "#5f6b7a",
    "--mc-panel": "#ffffff",
    "--mc-text": "#161b22",
  },
};
