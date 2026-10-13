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
 * soft, premium surfaces. Each step has one role, so two surfaces that sit
 * side by side on a screen always share a corner:
 *
 * - `lg` — every card: receipts, review panels, callouts, disclosures, grouped
 *   lists, and the send/swap composer cards.
 * - `md` — fields, standalone rows, and their hover fills.
 * - `sm` — compact controls and marks inside a card (toggles, icon choices).
 * - `full` — pills, chips, avatars, and the dock.
 * - `xl` — full-page chrome only: the onboarding card and the account
 *   drawer's edge.
 *
 * A row inside a grouped card takes no radius of its own: the card clips its
 * outer corners, so a fill never shows a second, mismatched curve.
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
  micro: { line: "1.25", size: "12px" },
  mono: { line: "1.5", size: "12px" },
  portfolio: { line: "1.05", size: "44px" },
  // The kit's `body` text style (16px on a 20px line): the verb and figure of
  // a list row, one step above `body` here so a row reads before its detail.
  row: { line: "1.25", size: "16px" },
  title: { line: "1.2", size: "17px" },
} as const;

/**
 * Motion durations in ms and the shared easing curves. `ease` settles
 * decisively. Feedback transforms stay within a 2px lift or a 0.96–1.0 scale
 * so controls feel alive without drifting under the pointer.
 */
export const MOTION = {
  drawerMs: 260,
  ease: "cubic-bezier(0.2, 0.7, 0.3, 1)",
  enterMs: 200,
  liftMs: 160,
  pressMs: 90,
  // The least time one step of a progress list stays on screen, so a step the
  // work finished in a few milliseconds is still read rather than flashed.
  // Display-only: the stage pacer holds what is painted, never the work.
  stageMinMs: 500,
  tabMs: 220,
  toastMs: 220,
  waitLoopMs: 2000,
} as const;

/**
 * Control metrics that keep hit targets and icons consistent.
 */
export const CONTROL = {
  dockIcon: "24px",
  dockItem: "44px",
  hit: "40px",
  hitSmall: "40px",
  icon: "18px",
  majorIcon: "22.5px",
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
  actionTile: "72px",
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
 * shadows cast in neutral black ink. Shadows are always darker than the surface
 * beneath them — a background-tinted shadow reads as a white glow on a light
 * ground, i.e. no elevation at all — so black at a low alpha deepens dark
 * surfaces and grounds light ones equally. Elevation is
 * deliberately restrained — cards lift by a hair, floating chrome (dock,
 * drawer) by a little more — so the interface stays flat and calm rather than
 * glossy. Structure is carried mostly by hairline edges; these shadows only
 * add the softest separation. `up` is the dock's upward cast.
 */
export const SHADOW = {
  lg: "0 24px 60px hsl(0 0% 0% / 0.36)",
  md: "0 12px 30px hsl(0 0% 0% / 0.24)",
  sm: "0 4px 14px hsl(0 0% 0% / 0.16)",
  up: "0 -8px 24px hsl(0 0% 0% / 0.10)",
  xs: "0 1px 2px hsl(0 0% 0% / 0.12)",
} as const;

/**
 * Strong easing curves for UI motion. The built-in CSS keywords are too weak;
 * these carry the intentional punch the design bar demands. `out` for
 * enter/exit (instant, responsive), `inOut` for on-screen moves, `drawer` for
 * sheets. Never use `ease-in` on UI — it delays the frame the user watches
 * most. `standard` mirrors the legacy `MOTION` curve for continuity.
 */
export const EASE = {
  drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
  inOut: "cubic-bezier(0.77, 0, 0.175, 1)",
  out: "cubic-bezier(0.23, 1, 0.32, 1)",
  standard: "cubic-bezier(0.2, 0.7, 0.3, 1)",
} as const;

/**
 * Named spring presets in Apple's designer-friendly parameters: `response`
 * (seconds-to-target, not a fixed duration) and `damping` (damping ratio —
 * 1.0 = critically damped, no overshoot; <1.0 bounces). Reserve bounce
 * (`drawer`/`momentum`) for motion that carried momentum. Convert to a WAAPI
 * `linear()` easing + duration via @bramble/ui-kit/spring.ts.
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
