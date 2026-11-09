/**
 * View-transition choreography for the side panel. The entrypoint wraps the
 * full-shell markup swap in the View Transitions API (feature-detected; see
 * ./index.ts) and sets `data-nav-direction` on the root element from the
 * navigation direction computed in `paint()`. These rules give each direction
 * a spatially consistent motion:
 *
 *   forward (push, going deeper)  — new screen enters from the right, old exits left
 *   back    (pop, going shallower)— new screen enters from the left, old exits right
 *   swap    (same depth, dock↔dock)— a calm cross-fade
 *
 * Motion is GPU-only (transform/opacity), asymmetric (the outgoing frame leaves
 * faster than the incoming settles), and stays under 300ms. Under reduced motion
 * the transition collapses to no animation (the entrypoint also skips the
 * transition entirely, cutting straight to the new screen).
 */
import { EASE } from "@bramble/ui-kit/tokens";

/**
 * View-transition stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const TRANSITION_STYLES = `
  ::view-transition-old(root), ::view-transition-new(root) {
    animation-duration: 200ms;
    animation-timing-function: ${EASE.out};
  }
  ::view-transition-old(root) { animation-duration: 120ms; }

  html[data-nav-direction="forward"]::view-transition-new(root) { animation-name: bramble-vt-in-right; }
  html[data-nav-direction="forward"]::view-transition-old(root) { animation-name: bramble-vt-out-left; }
  html[data-nav-direction="back"]::view-transition-new(root) { animation-name: bramble-vt-in-left; }
  html[data-nav-direction="back"]::view-transition-old(root) { animation-name: bramble-vt-out-right; }
  html[data-nav-direction="swap"]::view-transition-new(root) { animation-duration: 140ms; animation-name: bramble-vt-fade-in; }
  html[data-nav-direction="swap"]::view-transition-old(root) { animation-duration: 100ms; animation-name: bramble-vt-fade-out; }

  @keyframes bramble-vt-in-right {
    from { opacity: 0; transform: translateX(12px); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes bramble-vt-out-left {
    from { opacity: 1; transform: translateX(0); }
    to { opacity: 0; transform: translateX(-8px); }
  }
  @keyframes bramble-vt-in-left {
    from { opacity: 0; transform: translateX(-12px); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes bramble-vt-out-right {
    from { opacity: 1; transform: translateX(0); }
    to { opacity: 0; transform: translateX(8px); }
  }
  @keyframes bramble-vt-fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes bramble-vt-fade-out { from { opacity: 1; } to { opacity: 0; } }

  @media (prefers-reduced-motion: reduce) {
    ::view-transition-old(root), ::view-transition-new(root) { animation: none; }
  }
`;
