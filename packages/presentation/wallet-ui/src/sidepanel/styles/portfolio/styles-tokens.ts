/**
 * Token-emission layer of the side panel stylesheet. It publishes the
 * design-system scale tokens that need to reach CSS — the gentle elevation
 * scale, the strong easing curves, and the spring `linear()` easings — as
 * custom properties so every screen shares one source of truth.
 *
 * This layer carries NO visual material of its own: the "Clean Mono" direction
 * is deliberately flat, so surfaces are solid fills with hairline edges and low
 * shadows declared in the base/component/home layers. There is no glass
 * material, no `backdrop-filter`, and no ambient depth layer — only the scale
 * tokens below.
 */

import { resolveSpring } from "@mc-wallet/ui-kit/spring";
import { EASE, SHADOW } from "@mc-wallet/ui-kit/tokens";

const springDefault = resolveSpring("default");
const springDrawer = resolveSpring("drawer");
const springSnappy = resolveSpring("snappy");
const springMomentum = resolveSpring("momentum");

/**
 * Scale-token stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const TOKEN_STYLES = `
  :root {
    --mc-elev-xs: ${SHADOW.xs};
    --mc-elev-sm: ${SHADOW.sm};
    --mc-elev-md: ${SHADOW.md};
    --mc-elev-lg: ${SHADOW.lg};
    --mc-elev-up: ${SHADOW.up};
    --ease-standard: ${EASE.standard};
    --ease-out: ${EASE.out};
    --ease-in-out: ${EASE.inOut};
    --ease-drawer: ${EASE.drawer};
    --spring-default: ${springDefault.easing};
    --spring-default-ms: ${springDefault.durationMs}ms;
    --spring-drawer: ${springDrawer.easing};
    --spring-drawer-ms: ${springDrawer.durationMs}ms;
    --spring-snappy: ${springSnappy.easing};
    --spring-snappy-ms: ${springSnappy.durationMs}ms;
    --spring-momentum: ${springMomentum.easing};
    --spring-momentum-ms: ${springMomentum.durationMs}ms;
    /* Hairline ink for DIVIDERS between rows (and the dock's top rule). Rings
       around surfaces are gone from the language: structure comes from grouped
       fills, inset dividers, and gentle shadows — never a border per box. */
    --mc-hairline: color-mix(in srgb, var(--mc-text) 12%, transparent);
    --mc-hairline-strong: color-mix(in srgb, var(--mc-text) 18%, transparent);
  }
`;
