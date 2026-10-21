/**
 * Default wallet skin — the "Clean Mono" midnight theme. Every structural and
 * interactive role is achromatic: hierarchy comes from contrast, weight,
 * space, and motion rather than a brand hue. Green is reserved for
 * positive/success semantics, orange for degraded data, and red for danger/failure. Quiet-luxury
 * minimalism — flat and legible, not glass.
 *
 * Surfaces step in three quiet tiers over the background: `--bramble-sunken` for
 * recessed group containers (tab tracks, permission/sign panels), `--bramble-panel`
 * for cards, and `--bramble-elevated` for controls and rows. The steps are subtle;
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
    "--bramble-accent": "#f5f5f5",
    "--bramble-accent-text": "#171717",
    // Account birds draw on their own ground, so both skins share one palette:
    // dark bodies on pale grounds, bright accents on the bodies (contrast tested).
    "--bramble-account-avatar-accent-0": "#f2c14e",
    "--bramble-account-avatar-accent-1": "#f8a35e",
    "--bramble-account-avatar-accent-2": "#f7a8c8",
    "--bramble-account-avatar-accent-3": "#7fdccf",
    "--bramble-account-avatar-body-0": "#6842a8",
    "--bramble-account-avatar-body-1": "#9f356f",
    "--bramble-account-avatar-body-2": "#1d6a72",
    "--bramble-account-avatar-body-3": "#3545cd",
    "--bramble-account-avatar-body-4": "#3f6b2a",
    "--bramble-account-avatar-ground-0": "#fbe9c6",
    "--bramble-account-avatar-ground-1": "#f7d6df",
    "--bramble-account-avatar-ground-2": "#d3ecdc",
    "--bramble-account-avatar-ground-3": "#d9e0f8",
    "--bramble-account-avatar-ink": "#171717",
    "--bramble-account-avatar-paper": "#fafafa",
    "--bramble-bg": "#0a0a0a",
    // Field edge (see default-skin): >= 3:1 against every surface tier, tested.
    "--bramble-border": "#767676",
    "--bramble-danger": "#ff7474",
    "--bramble-elevated": "#242424",
    "--bramble-muted": "#a3a3a3",
    "--bramble-panel": "#151515",
    "--bramble-positive": "#4ade80",
    "--bramble-sunken": "#101010",
    "--bramble-text": "#f5f5f5",
    "--bramble-warning": "#fb923c",
  },
};
