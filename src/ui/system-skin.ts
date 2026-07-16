/**
 * "System" wallet skin — the default theme. Unlike the pinned `midnight`
 * (`darkSkin`) and `daylight` (`defaultSkin`) Clean Mono palettes, this skin
 * sources its NEUTRALS from CSS system-color keywords so the panel matches
 * exactly what the browser renders for the active scheme, and auto-flips
 * light/dark with no JavaScript.
 *
 * The flip is driven entirely by CSS: the side panel root is set to
 * `color-scheme: light dark` (see ../sidepanel/theme + index.ts) so the system
 * colors below (`Canvas`, `CanvasText`, `GrayText`, `ButtonFace`) and the
 * `light-dark()` brand values resolve to the browser's light or dark rendering
 * automatically. A Chrome MV3 side-panel page cannot read the browser's active
 * theme colors (no `chrome.theme` read API, no `env()` path); `prefers-color-
 * scheme`, `color-scheme`, and the UA system-color keywords are the only signal
 * available, so the neutrals ride those.
 *
 * Neutral mapping (matched pairs, for guaranteed contrast on either ground):
 *   - `--mc-bg` / `--mc-panel` / `--mc-sunken` → `Canvas` (the page surface;
 *     recessed group fills and cards blend with the page and are separated by
 *     the hairline edge below, keeping the calm, low-elevation Clean Mono
 *     structure).
 *   - `--mc-elevated` → `ButtonFace` (the raised control surface used by rows,
 *     inputs, and secondary/danger buttons; `ButtonText` is the matched text).
 *   - `--mc-text` → `CanvasText` (primary text).
 *   - `--mc-muted` → `GrayText` (muted/secondary text).
 *   - `--mc-border` → a hairline derived from `CanvasText`, mirroring the
 *     stylesheet's `--mc-hairline`. `ButtonBorder` is intentionally avoided as
 *     its support is narrower than `color-mix()`, which the derived tokens
 *     already require.
 *
 * The cobalt brand accent and the up/down market semantics are NOT system
 * colors — Chrome does not expose the browser's accent to a normal extension
 * page, so they stay as designed tokens. They keep the exact
 * `daylight`/`midnight` values, selected per ground by `light-dark()` so the
 * CTA fill, active states, gains, and losses read correctly against whichever
 * scheme the browser resolves `color-scheme: light dark` to.
 */
import type { Skin } from "./skin";

/**
 * Default skin that follows the browser's own light/dark rendering: neutrals
 * from CSS system colors, brand color from `light-dark()` cobalt, market
 * semantics from `light-dark()` green/red.
 */
export const systemSkin: Skin = {
  name: "system",
  tokens: {
    "--mc-accent": "light-dark(#1f57e0, #5c8dff)",
    "--mc-accent-text": "light-dark(#ffffff, #0a1220)",
    "--mc-bg": "Canvas",
    "--mc-border": "color-mix(in srgb, CanvasText 12%, transparent)",
    "--mc-danger": "light-dark(#c23434, #f87171)",
    "--mc-elevated": "ButtonFace",
    "--mc-muted": "GrayText",
    "--mc-panel": "Canvas",
    "--mc-positive": "light-dark(#0a7a4d, #2fcf8e)",
    "--mc-sunken": "Canvas",
    "--mc-text": "CanvasText",
  },
};
