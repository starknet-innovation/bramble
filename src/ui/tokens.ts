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
  headline: { line: "1.15", size: "28px" },
  label: { line: "1.3", size: "13px" },
  micro: { line: "1.2", size: "11px" },
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

/**
 * Font-weight scale. Hierarchy is built from weight together with size and
 * leading (per Apple type guidance), not size alone: `heavy` for the portfolio
 * total, `bold` for headings, `semibold` for values, `medium` for labels.
 */
export const WEIGHT = {
  bold: 700,
  heavy: 800,
  medium: 600,
  regular: 400,
  semibold: 650,
} as const;

/**
 * Size-specific letter-spacing. Tracking is never one value for all sizes:
 * large display text tightens (letters read too far apart as they grow) while
 * small and uppercase text opens up slightly for legibility.
 */
export const TRACKING = {
  amount: "-0.03em",
  body: "0",
  caption: "0.01em",
  display: "-0.02em",
  eyebrow: "0.08em",
  label: "-0.01em",
  title: "-0.01em",
} as const;

/**
 * Element/height sub-scale absorbing the ad-hoc control, avatar, row, and tile
 * pixel values that were previously sprinkled through the stylesheet, so every
 * fixed dimension traces back to one place.
 */
export const SIZE = {
  art: "56px",
  avatar: "36px",
  brand: "64px",
  control: "46px",
  mark: "40px",
  pill: "28px",
  row: "58px",
  rowCompact: "56px",
  sparkline: "48px",
  tile: "72px",
} as const;

/**
 * Elevation / shadow scale for the "Clean Mono" look: gentle, low, near-diffuse
 * shadows cast in a fixed cool-slate ink. Shadows are always darker than the
 * surface beneath them — a background-tinted shadow reads as a white glow on a
 * light ground, i.e. no elevation at all — so the ink is a deep slate at a low
 * alpha that deepens dark surfaces and grounds light ones equally. Elevation is
 * deliberately restrained — cards lift by a hair, floating chrome (dock,
 * drawer) by a little more — so the interface stays flat and calm rather than
 * glossy. Structure is carried mostly by hairline edges; these shadows only
 * add the softest separation. `up` is the dock's upward cast.
 */
export const SHADOW = {
  lg: "0 24px 60px hsl(222 40% 4% / 0.36)",
  md: "0 12px 30px hsl(222 40% 4% / 0.24)",
  sm: "0 4px 14px hsl(222 40% 4% / 0.16)",
  up: "0 -8px 24px hsl(222 40% 4% / 0.10)",
  xs: "0 1px 2px hsl(222 40% 4% / 0.12)",
} as const;

/**
 * Strong easing curves for UI motion. The built-in CSS keywords are too weak;
 * these carry the intentional punch the design bar demands. `out` for
 * enter/exit (instant, responsive), `inOut` for on-screen moves, `drawer` for
 * sheets. Never use `ease-in` on UI — it delays the frame the user watches
 * most. `standard`/`pop` mirror the legacy `MOTION` curves for continuity.
 */
export const EASE = {
  drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
  inOut: "cubic-bezier(0.77, 0, 0.175, 1)",
  out: "cubic-bezier(0.23, 1, 0.32, 1)",
  pop: "cubic-bezier(0.34, 1.3, 0.4, 1)",
  standard: "cubic-bezier(0.2, 0.7, 0.3, 1)",
} as const;

/**
 * Named spring presets in Apple's designer-friendly parameters: `response`
 * (seconds-to-target, not a fixed duration) and `damping` (damping ratio —
 * 1.0 = critically damped, no overshoot; <1.0 bounces). Reserve bounce
 * (`drawer`/`momentum`) for motion that carried momentum. Convert to a WAAPI
 * `linear()` easing + duration via ../ui/spring.ts.
 */
export const SPRING = {
  default: { damping: 1, response: 0.4 },
  drawer: { damping: 0.8, response: 0.3 },
  momentum: { damping: 0.8, response: 0.4 },
  snappy: { damping: 1, response: 0.3 },
} as const;

/**
 * Name of a named spring preset.
 */
export type SpringName = keyof typeof SPRING;

/**
 * Spring parameters in Apple's response/damping form.
 */
export type SpringSpec = (typeof SPRING)[SpringName];
