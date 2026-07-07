/**
 * Default wallet skin. Replace this import to swap the UI palette.
 *
 * The default reads as a banknote: deep viridian signal color on cool
 * porcelain, with every neutral shifted slightly green so the eight tokens
 * feel like one material rather than a generic blue-on-gray template.
 */
import type { Skin } from "./skin";

/**
 * Built-in skin used by the default extension build.
 */
export const defaultSkin: Skin = {
  name: "banknote",
  tokens: {
    "--mc-accent": "#12655b",
    "--mc-accent-text": "#f2faf7",
    "--mc-bg": "#eef1f0",
    "--mc-border": "#d4dcd9",
    "--mc-danger": "#b3261e",
    "--mc-muted": "#5a6663",
    "--mc-panel": "#ffffff",
    "--mc-text": "#141a18",
  },
};
