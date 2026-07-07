/**
 * Dark wallet skin: the banknote palette inverted onto deep viridian-tinted
 * ink, keeping the same eight-token contract as the light default.
 */
import type { Skin } from "./skin";

/**
 * Built-in dark skin selected through the theme preference.
 */
export const darkSkin: Skin = {
  name: "banknote-dark",
  tokens: {
    "--mc-accent": "#3aa98d",
    "--mc-accent-text": "#0c1512",
    "--mc-bg": "#0f1413",
    "--mc-border": "#2a3330",
    "--mc-danger": "#e5484d",
    "--mc-muted": "#93a09b",
    "--mc-panel": "#171d1b",
    "--mc-text": "#e8edeb",
  },
};
