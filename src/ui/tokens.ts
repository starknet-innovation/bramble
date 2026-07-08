/**
 * Design-system scale tokens shared by extension UI stylesheets.
 *
 * Colors deliberately live in the swappable `Skin` contract (see ./skin.ts);
 * every other axis of the visual language — spacing, radius, type, motion,
 * and control metrics — is standardised here so screens stay consistent and
 * the system can be tuned in one place.
 */

/**
 * Spacing scale on a 4px grid, from tightest inset to section rhythm.
 */
export const SPACE = {
  lg: "16px",
  md: "12px",
  sm: "8px",
  xl: "24px",
  xs: "4px",
} as const;

/**
 * Corner radius scale for controls, cards, and pills. Generous rounding for
 * soft, premium surfaces.
 */
export const RADIUS = {
  full: "999px",
  lg: "20px",
  md: "14px",
  sm: "10px",
  xl: "24px",
} as const;

/**
 * Font stacks: interface text plus the mono voice used for addresses, hashes,
 * and amounts — the data a wallet exists to present.
 */
export const FONT = {
  mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
  ui: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
} as const;

/**
 * Type scale with matched line heights. Bolder, larger display sizes give the
 * portfolio total and headings a confident presence.
 */
export const TYPE = {
  amount: { line: "1.1", size: "36px" },
  body: { line: "1.45", size: "14px" },
  caption: { line: "1.35", size: "12px" },
  display: { line: "1.2", size: "22px" },
  label: { line: "1.3", size: "13px" },
  mono: { line: "1.5", size: "12px" },
  title: { line: "1.2", size: "17px" },
} as const;

/**
 * Motion durations in ms and the shared easing curves. `ease` settles
 * decisively; `pop` carries a slight overshoot reserved for press-release and
 * entrance moments. Feedback transforms stay within a 2px lift or a 0.96–1.0
 * scale so controls feel alive without drifting under the pointer.
 */
export const MOTION = {
  drawerMs: 260,
  ease: "cubic-bezier(0.2, 0.7, 0.3, 1)",
  enterMs: 200,
  liftMs: 160,
  pop: "cubic-bezier(0.34, 1.3, 0.4, 1)",
  pressMs: 90,
  tabMs: 220,
  toastMs: 220,
} as const;

/**
 * Control metrics that keep hit targets and icons consistent.
 */
export const CONTROL = {
  hit: "40px",
  hitSmall: "32px",
  icon: "18px",
  nav: "52px",
} as const;
