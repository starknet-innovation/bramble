/**
 * Pure theme resolution: maps the stored `ThemeChoice` to the concrete skin and
 * the CSS `color-scheme` value the side panel applies to its root. Kept free of
 * DOM access so it can be unit-tested and reused; the entrypoint (see
 * ../sidepanel/index.ts) is the only place that writes the results to the page.
 *
 * The wallet ships exactly two designed skins — `midnight` (default) and
 * `daylight`. The former "system" theme (neutrals from CSS system colors) was
 * removed: system colors like `ButtonFace`/`GrayText` land far off the designed
 * surface tiers (fields rendered much lighter than the dark skin, muted text
 * failed WCAG contrast), so every install now runs a pinned, contrast-audited
 * palette. `"system"` survives only as a legacy stored value and resolves to
 * the default dark skin.
 */
import type { ThemeChoice } from "../storage/preferences-store";
import { darkSkin } from "./dark-skin";
import { defaultSkin } from "./default-skin";
import type { Skin } from "./skin";

/**
 * Resolves the concrete skin for a theme choice: `"light"` pins the Clean Mono
 * `daylight` skin; `"dark"` — and the legacy `"system"` value from installs
 * that predate the setting's removal — pin the default `midnight` skin.
 */
export const skinForChoice = (choice: ThemeChoice): Skin =>
  choice === "light" ? defaultSkin : darkSkin;

/**
 * CSS `color-scheme` value for a theme choice. Always a single pinned scheme —
 * matching the resolved skin — so native form controls, scrollbars, and the
 * checkbox accent render on the same ground as the skin, and a browser scheme
 * flip can never re-theme a pinned palette.
 */
export const colorSchemeForChoice = (choice: ThemeChoice): string =>
  choice === "light" ? "light" : "dark";
