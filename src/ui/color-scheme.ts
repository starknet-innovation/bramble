/**
 * Browser color-scheme detection for the "system" theme choice.
 *
 * Chrome draws a theme-tinted border around the side panel, so matching the
 * browser's light/dark scheme makes the wallet read as part of the browser
 * rather than a foreign frame. The only stable signal a side-panel page
 * gets is the `prefers-color-scheme` media query — Chrome exposes no API for a
 * user's *custom* theme accent/frame colors — so detection is limited to
 * light-vs-dark, with dark as the standard fallback when the query is
 * unavailable (e.g. non-DOM test contexts) or does not resolve to light.
 *
 * Detection uses the bare `matchMedia` global, guarded for environments without
 * a DOM, mirroring ../sidepanel/motion.ts's reduced-motion probe.
 */

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";
const LIGHT_SCHEME_QUERY = "(prefers-color-scheme: light)";

const query = (media: string): MediaQueryList | null =>
  typeof matchMedia === "function" ? matchMedia(media) : null;

/**
 * Reports whether the browser currently prefers a dark color scheme. Returns
 * `true` (the standard dark fallback) whenever the light preference does not
 * explicitly match — either because the browser prefers dark, expresses no
 * preference, or `matchMedia` is unavailable.
 */
export const systemPrefersDark = (): boolean => query(LIGHT_SCHEME_QUERY)?.matches !== true;

/**
 * Subscribes to browser color-scheme changes, invoking `onChange` whenever the
 * user flips the OS/browser between light and dark while the panel is open, so
 * the wallet can re-theme live. Returns an unsubscribe function; when
 * `matchMedia` is unavailable it is a no-op.
 */
export const watchSystemScheme = (onChange: () => void): (() => void) => {
  const media = query(DARK_SCHEME_QUERY);
  if (!media) {
    return () => undefined;
  }
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
