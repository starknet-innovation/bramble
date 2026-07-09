/**
 * Side panel stylesheet composed from the shared design-system tokens.
 *
 * ANIMATION STORYBOARD
 *
 * Read top-to-bottom. Each value is ms after render or interaction.
 *
 *   0ms   shell mounts; layout is stable from the first frame
 *  90ms   hover and press feedback settles — background shifts plus a
 *         restrained 2px lift or 0.96–1.0 press scale on tiles and rows
 * 200ms   a newly opened screen slides in along the navigation direction via
 *         the View Transitions API (cross-fade fallback); the hero, action
 *         tiles, and first six token rows follow in a 30–40ms stagger
 * 220ms   the emerald tab indicator glides to the active tab while the
 *         incoming panel cross-fades; toasts slide into the fixed stack
 * 260ms   the account drawer springs in over a dimmed backdrop, its rows
 *         cascading in behind it
 *
 * Layer order (composed below): base tokens/layout → Liquid Glass material →
 * component classes → view-transition choreography → home/motion. The home
 * layer is composed last so its prefers-reduced-motion block wins over every
 * earlier animation and transition.
 *
 * Stability contract: interactive controls are borderless; transforms stay
 * within a 2px lift or a 0.96 scale so nothing drifts under the pointer, and
 * every animation and transition collapses under prefers-reduced-motion.
 */
import { BASE_STYLES } from "./styles-base";
import { COMPONENT_STYLES } from "./styles-components";
import { HOME_STYLES } from "./styles-home";
import { MATERIAL_STYLES } from "./styles-material";
import { TRANSITION_STYLES } from "./styles-transitions";

/**
 * Skin-token-only stylesheet injected by the side panel entrypoint.
 */
export const SIDEPANEL_STYLES = `${BASE_STYLES}${MATERIAL_STYLES}${COMPONENT_STYLES}${TRANSITION_STYLES}
${HOME_STYLES}`;
