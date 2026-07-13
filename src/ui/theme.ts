/**
 * Pure theme resolution: maps the stored `ThemeChoice` to the concrete skin and
 * the CSS `color-scheme` value the side panel applies to its root. Kept free of
 * DOM access so it can be unit-tested and reused; the entrypoint (see
 * ../sidepanel/index.ts) is the only place that writes the results to the page.
 */
import type { ThemeChoice } from "../storage/preferences-store";
import { darkSkin } from "./dark-skin";
import { defaultSkin } from "./default-skin";
import type { Skin } from "./skin";
import { systemSkin } from "./system-skin";

/**
 * Resolves the concrete skin for a theme choice. `"system"` (the default) uses
 * `systemSkin`, whose neutrals come from CSS system colors and flip with the
 * browser scheme; `"dark"`/`"light"` pin the Clean Mono `midnight`/`daylight`
 * skins regardless of the browser scheme.
 */
export const skinForChoice = (choice: ThemeChoice): Skin =>
  choice === "light" ? defaultSkin : choice === "dark" ? darkSkin : systemSkin;

/**
 * CSS `color-scheme` value for a theme choice. `"system"` opts the panel into
 * `light dark` so the system-color keywords and `light-dark()` values in
 * `systemSkin` resolve to the browser's active scheme; a pinned `"dark"`/
 * `"light"` fixes the scheme so a pinned Clean Mono skin cannot be flipped by
 * the browser preference.
 */
export const colorSchemeForChoice = (choice: ThemeChoice): string =>
  choice === "dark" ? "dark" : choice === "light" ? "light" : "light dark";
