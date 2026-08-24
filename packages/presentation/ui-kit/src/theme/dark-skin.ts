/**
 * Default wallet skin — the "Clean Mono" midnight theme. Every structural and
 * interactive role is achromatic: hierarchy comes from contrast, weight,
 * space, and motion rather than a brand hue. Green is reserved for
 * positive/success semantics, orange for degraded data, and red for danger/failure. Quiet-luxury
 * minimalism — flat and legible, not glass.
 *
 * Surfaces step in three quiet tiers over the background: `--mc-sunken` for
 * recessed group containers (tab tracks, permission/sign panels), `--mc-panel`
 * for cards, and `--mc-elevated` for controls and rows. The steps are subtle;
 * separation is carried by hairline edges and gentle low shadows, so the whole
 * panel reads as calm layered paper rather than lit material. Every
 * text/ground pairing is guarded by the contrast test suite.
 */
import type { Skin } from "./skin";

/**
 * Built-in dark skin used by the default extension build.
 */
export const darkSkin: Skin = {
  name: "midnight",
  tokens: {
    "--mc-accent": "#f5f5f5",
    "--mc-accent-text": "#171717",
    "--mc-account-avatar-0": "#6842a8",
    "--mc-account-avatar-1": "#e27a35",
    "--mc-account-avatar-2": "#e9b83f",
    "--mc-account-avatar-3": "#9f356f",
    "--mc-account-avatar-ink": "#171717",
    "--mc-account-avatar-paper": "#fafafa",
    "--mc-bg": "#0a0a0a",
    "--mc-border": "#2b2b2b",
    "--mc-danger": "#ff7474",
    "--mc-elevated": "#242424",
    "--mc-muted": "#a3a3a3",
    "--mc-panel": "#151515",
    "--mc-positive": "#4ade80",
    "--mc-sunken": "#101010",
    "--mc-text": "#f5f5f5",
    "--mc-warning": "#fb923c",
  },
};
