/**
 * Side panel stylesheet composed from the shared design-system tokens.
 *
 * DESIGN DIRECTION — "Clean Mono": quiet-luxury minimalism. Structural roles
 * are near-neutral: achromatic in the default midnight skin, the Bramble
 * Design Kit's blue-grey tinted ramp with its brand-blue accent in daylight.
 * Contrast, weight, space, and motion carry hierarchy. Green is reserved for
 * positive/success semantics and red for danger/failure. Hairline edges,
 * gentle low elevation, generous whitespace, and a crisp, precise type scale.
 * Deliberately FLAT and legible — no gradients, no glass, no aurora, no
 * backdrop-filter.
 *
 * ANIMATION STORYBOARD
 *
 * Read top-to-bottom. Each value is ms after render or interaction.
 *
 *   0ms   shell mounts; layout is stable from the first frame
 *  90ms   hover and press feedback settles through color and a restrained
 *         0.96–1.0 press scale
 * 160ms   a dismissed token sheet settles down and restores trigger focus
 * 200ms   a newly opened screen moves along navigation direction; token sheets
 *         rise into protected focus; a dapp takeover names the paused task
 * 220ms   semantic live values and toasts settle without animating unchanged data
 * 260ms   the account drawer follows gesture momentum into its resting edge
 *
 * Motion is calm, small, fast (<300ms), GPU-only (transform/opacity), on strong
 * curves, and everything collapses to a cut under prefers-reduced-motion.
 *
 * Layer order (composed below): scale tokens → base tokens/layout → controls
 * (buttons, forms, focus, gates) → structure (receipt, segmented control,
 * disclosure, takeover) → component classes → view-transition choreography →
 * home/motion. The home layer is composed last so its prefers-reduced-motion
 * block wins over every earlier animation and transition.
 *
 * Stability contract: interactive controls are borderless (structure comes from
 * elevation, hairline edges, and space); feedback transforms stay within a 2px
 * lift or a 0.92 scale so nothing drifts under the pointer; hover styles are
 * gated to fine pointers so touch never strands a phantom hover; and every
 * animation and transition collapses under prefers-reduced-motion.
 */
import { BASE_STYLES } from "./core/styles-base";
import { COMPONENT_STYLES } from "./core/styles-components";
import { CONTROL_STYLES } from "./core/styles-controls";
import { DECISION_STYLES } from "./core/styles-decisions";
import { DOCK_STYLES } from "./core/styles-dock";
import { JOURNEY_STYLES } from "./core/styles-journeys";
import { PROGRESS_STYLES } from "./core/styles-progress";
import { STRUCTURE_STYLES } from "./core/styles-structure";
import { TRANSITION_STYLES } from "./core/styles-transitions";
import { MULTISIG_STYLES } from "./multisig/styles-multisig";
import { MULTISIG_PARTICIPANT_STYLES } from "./multisig/styles-multisig-participant";
import { ONBOARDING_STYLES } from "./onboarding/styles-onboarding";
import { ONBOARDING_CONTRACT_STYLES } from "./onboarding/styles-onboarding-contract";
import { ONBOARDING_WELCOME_STYLES } from "./onboarding/styles-onboarding-welcome";
import { ACTIVITY_STYLES } from "./portfolio/styles-activity";
import { HOME_STYLES } from "./portfolio/styles-home";
import { TOKEN_STYLES } from "./portfolio/styles-tokens";
import { PRIVACY_STYLES } from "./privacy/styles-privacy";
import { SEND_STYLES } from "./send/styles-send";
import { SEND_COMPOSE_STYLES } from "./send/styles-send-compose";
import { SEND_OUTCOME_STYLES } from "./send/styles-send-outcome";
import { GROUP_STYLES } from "./settings/styles-groups";
import { SWAP_STYLES } from "./swap/styles-swap";

/**
 * Skin-token-only stylesheet injected by the side panel entrypoint.
 */
export const SIDEPANEL_STYLES = `${TOKEN_STYLES}${BASE_STYLES}${DOCK_STYLES}${CONTROL_STYLES}${STRUCTURE_STYLES}${DECISION_STYLES}${SWAP_STYLES}${PROGRESS_STYLES}${PRIVACY_STYLES}${SEND_STYLES}${SEND_COMPOSE_STYLES}${SEND_OUTCOME_STYLES}${COMPONENT_STYLES}${ACTIVITY_STYLES}${JOURNEY_STYLES}${MULTISIG_STYLES}${MULTISIG_PARTICIPANT_STYLES}${TRANSITION_STYLES}${GROUP_STYLES}
${HOME_STYLES}${ONBOARDING_CONTRACT_STYLES}${ONBOARDING_STYLES}${ONBOARDING_WELCOME_STYLES}`;
