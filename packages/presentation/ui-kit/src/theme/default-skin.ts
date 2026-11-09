/**
 * Light wallet skin — the "Clean Mono" daylight theme. The dark `midnight`
 * skin is the default build; this is the light alternate selected through the
 * theme preference. Structural roles are drawn from the Bramble Design Kit's
 * blue-grey tinted neutral ramp, so hierarchy still comes from contrast,
 * weight, space, and motion; the single brand hue is the accent, drawn from
 * the kit's blue ramp. Green is reserved for positive/success semantics and
 * red for danger/failure; orange (not in the kit) is reserved for degraded
 * data. Flat and legible, not glass — solid fills only, never a gradient.
 *
 * Surfaces step in three quiet tiers: `--bramble-sunken` (kit `bg/well`) for
 * recessed group containers, `--bramble-panel` (pure white, kit `bg/ground`)
 * for cards, and `--bramble-elevated` (also `bg/well`) for controls and rows.
 * Separation is carried by hairline edges and gentle low shadows.
 *
 * The accent is one token for both the CTA fill and accent ink, so it must
 * hold AA as text on every surface tier. The kit's `accent/base` (blue/600)
 * only reaches 4.4:1 on the well tier, so this skin pins the next step,
 * blue/700, which clears AA everywhere. Every text/ground pairing is guarded
 * by the contrast test suite.
 */
import type { Skin } from "./skin";

/**
 * Built-in light skin used when the theme preference selects light mode.
 */
export const defaultSkin: Skin = {
  name: "daylight",
  tokens: {
    "--bramble-accent": "#3545cd",
    "--bramble-accent-text": "#ffffff",
    // Account birds draw on their own ground, so both skins share one palette:
    // dark bodies on pale grounds, bright accents on the bodies. Contrast and
    // colour-blind separation are both tested in skin-contrast.test.ts.
    "--bramble-account-avatar-accent-0": "#f5c64b",
    "--bramble-account-avatar-accent-1": "#fbb05d",
    "--bramble-account-avatar-accent-2": "#fdaecf",
    "--bramble-account-avatar-accent-3": "#80e1e3",
    "--bramble-account-avatar-body-0": "#6842a8",
    "--bramble-account-avatar-body-1": "#9f3570",
    "--bramble-account-avatar-body-2": "#1c626e",
    "--bramble-account-avatar-body-3": "#343dc7",
    "--bramble-account-avatar-body-4": "#3f662a",
    "--bramble-account-avatar-ground-0": "#faeac5",
    "--bramble-account-avatar-ground-1": "#f1c9df",
    "--bramble-account-avatar-ground-2": "#d2efda",
    "--bramble-account-avatar-ground-3": "#dbd7fd",
    "--bramble-account-avatar-ink": "#0e0f16",
    "--bramble-account-avatar-paper": "#ffffff",
    "--bramble-bg": "#f8f9fb",
    // Field edge: the boundary that identifies an input. Non-text contrast of at
    // least 3:1 against every surface tier a field sits on (spec item 25), pinned
    // by the skin contrast test. Hairlines and dividers use the derived
    // --bramble-hairline instead, so this stays a control edge, not a divider.
    "--bramble-border": "#767a94",
    "--bramble-danger": "#a32f2f",
    "--bramble-elevated": "#f2f3f7",
    "--bramble-muted": "#50536d",
    "--bramble-panel": "#ffffff",
    "--bramble-positive": "#476312",
    "--bramble-sunken": "#f2f3f7",
    "--bramble-text": "#0e0f16",
    "--bramble-warning": "#9a3412",
  },
};
