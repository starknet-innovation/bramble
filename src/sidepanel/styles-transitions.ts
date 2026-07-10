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
import { EASE } from "../ui/tokens";

/**
 * View-transition stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const TRANSITION_STYLES = `
  ::view-transition-old(root), ::view-transition-new(root) {
    animation-duration: 220ms;
    animation-timing-function: ${EASE.out};
  }
  ::view-transition-old(root) { animation-duration: 160ms; }

  html[data-nav-direction="forward"]::view-transition-new(root) { animation-name: mc-vt-in-right; }
  html[data-nav-direction="forward"]::view-transition-old(root) { animation-name: mc-vt-out-left; }
  html[data-nav-direction="back"]::view-transition-new(root) { animation-name: mc-vt-in-left; }
  html[data-nav-direction="back"]::view-transition-old(root) { animation-name: mc-vt-out-right; }
  html[data-nav-direction="swap"]::view-transition-new(root) { animation-name: mc-vt-fade-in; }
  html[data-nav-direction="swap"]::view-transition-old(root) { animation-name: mc-vt-fade-out; }

  @keyframes mc-vt-in-right {
    from { opacity: 0; transform: translateX(6%); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes mc-vt-out-left {
    from { opacity: 1; transform: translateX(0); }
    to { opacity: 0; transform: translateX(-4%); }
  }
  @keyframes mc-vt-in-left {
    from { opacity: 0; transform: translateX(-6%); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes mc-vt-out-right {
    from { opacity: 1; transform: translateX(0); }
    to { opacity: 0; transform: translateX(4%); }
  }
  @keyframes mc-vt-fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes mc-vt-fade-out { from { opacity: 1; } to { opacity: 0; } }

  @media (prefers-reduced-motion: reduce) {
    ::view-transition-old(root), ::view-transition-new(root) { animation: none; }
  }
`;
