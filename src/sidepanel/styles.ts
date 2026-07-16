/**
 * Side panel stylesheet composed from the shared design-system tokens.
 *
 * DESIGN DIRECTION — "Clean Mono": quiet-luxury minimalism. A near-monochrome
 * neutral palette in both skins with a single restrained cobalt accent used
 * only where it earns attention (primary CTA, active states, focus), while
 * market and status semantics keep their own tokens — green strictly for gains
 * and success, red for losses and danger — so brand never masquerades as
 * signal. Hairline edges, gentle low elevation, generous whitespace, and a
 * crisp, precise type scale. Deliberately FLAT and legible — no glass, no
 * aurora, no backdrop-filter.
 *
 * ANIMATION STORYBOARD
 *
 * Read top-to-bottom. Each value is ms after render or interaction.
 *
 *   0ms   shell mounts; layout is stable from the first frame
 *  90ms   hover and press feedback settles — a quiet background shift plus a
 *         subtle 0.92–1.0 press scale on the strong ease-out curve (never an
 *         overshoot on the press-down frame)
 * 200ms   a newly opened screen slides in along the navigation direction via
 *         the View Transitions API (cross-fade fallback); the hero, action
 *         tiles, and first six token rows follow in a small 30–40ms stagger
 * ~260ms  the cobalt tab underline glides to the active tab on the snappy
 *         spring while the incoming panel cross-fades; toasts slide into the
 *         fixed stack above the anchored dock
 * 260ms   the account drawer settles in over a dimmed backdrop, its rows
 *         cascading in behind it
 *
 * Motion is calm, small, fast (<300ms), GPU-only (transform/opacity), on strong
 * curves, and everything collapses to a cut under prefers-reduced-motion.
 *
 * Layer order (composed below): scale tokens → base tokens/layout → controls
 * (buttons, forms, focus, gates) → component classes → view-transition
 * choreography → home/motion. The home layer is composed last so its
 * prefers-reduced-motion block wins over every earlier animation and
 * transition.
 *
 * Stability contract: interactive controls are borderless (structure comes from
 * elevation, hairline edges, and space); feedback transforms stay within a 2px
 * lift or a 0.92 scale so nothing drifts under the pointer; hover styles are
 * gated to fine pointers so touch never strands a phantom hover; and every
 * animation and transition collapses under prefers-reduced-motion.
 */
import { BASE_STYLES } from "./styles-base";
import { COMPONENT_STYLES } from "./styles-components";
import { CONTROL_STYLES } from "./styles-controls";
import { HOME_STYLES } from "./styles-home";
import { TOKEN_STYLES } from "./styles-tokens";
import { TRANSITION_STYLES } from "./styles-transitions";

/**
 * Skin-token-only stylesheet injected by the side panel entrypoint.
 */
export const SIDEPANEL_STYLES = `${TOKEN_STYLES}${BASE_STYLES}${CONTROL_STYLES}${COMPONENT_STYLES}${TRANSITION_STYLES}
${HOME_STYLES}`;
