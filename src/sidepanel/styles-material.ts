/**
 * Material and token-emission layer of the side panel stylesheet. Publishes the
 * design-system scale tokens that need to reach CSS — the elevation scale, the
 * strong easing curves, and the spring `linear()` easings — as custom
 * properties, and defines the reusable Apple-style "Liquid Glass" material.
 *
 * Liquid Glass is opt-in: add `class="glass"` to a surface (sheet, dock, card,
 * approval prompt) to give it real translucency (`backdrop-filter` blur +
 * saturate), a layered tint driven by the active skin, a specular edge
 * highlight (inset top light), and a depth shadow. Do not plaster it
 * everywhere — one translucent layer at a time, never stacked. Where
 * `backdrop-filter` is unsupported the material degrades to a solid panel, and
 * it frosts to near-solid under prefers-reduced-transparency / prefers-contrast.
 *
 * Colors stay token-driven: the tint is `color-mix` over skin tokens, and the
 * specular highlight is an intentional physical light — a translucent rgba that
 * stays the same across themes, because light catching an edge does not change
 * with the palette — never a hard-coded color literal.
 */

import { resolveSpring } from "../ui/spring";
import { EASE, SHADOW } from "../ui/tokens";

const springDefault = resolveSpring("default");
const springDrawer = resolveSpring("drawer");
const springSnappy = resolveSpring("snappy");
const springMomentum = resolveSpring("momentum");

/**
 * Material stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const MATERIAL_STYLES = `
  :root {
    --mc-elev-xs: ${SHADOW.xs};
    --mc-elev-sm: ${SHADOW.sm};
    --mc-elev-md: ${SHADOW.md};
    --mc-elev-lg: ${SHADOW.lg};
    --mc-elev-glass: ${SHADOW.glass};
    --ease-standard: ${EASE.standard};
    --ease-out: ${EASE.out};
    --ease-in-out: ${EASE.inOut};
    --ease-drawer: ${EASE.drawer};
    --ease-pop: ${EASE.pop};
    --spring-default: ${springDefault.easing};
    --spring-default-ms: ${springDefault.durationMs}ms;
    --spring-drawer: ${springDrawer.easing};
    --spring-drawer-ms: ${springDrawer.durationMs}ms;
    --spring-snappy: ${springSnappy.easing};
    --spring-snappy-ms: ${springSnappy.durationMs}ms;
    --spring-momentum: ${springMomentum.easing};
    --spring-momentum-ms: ${springMomentum.durationMs}ms;
    /* Liquid Glass tint + light, adaptive through the skin panel token */
    --mc-glass-bg: color-mix(in srgb, var(--mc-panel) 62%, transparent);
    --mc-glass-tint: color-mix(in srgb, var(--mc-panel) 82%, transparent);
    --mc-glass-highlight: rgba(255, 255, 255, 0.14);
    --mc-glass-edge: rgba(255, 255, 255, 0.06);
    --mc-glass-shadow: var(--mc-elev-glass);
  }

  /* Liquid Glass: one translucent floating layer. Blur + saturate lift the
     content underneath; the inset top highlight reads as light catching the
     material edge; the depth shadow separates it from the page. */
  .glass {
    background: var(--mc-glass-bg);
    -webkit-backdrop-filter: blur(22px) saturate(180%);
    backdrop-filter: blur(22px) saturate(180%);
    box-shadow:
      inset 0 1px 0 var(--mc-glass-highlight),
      inset 0 0 0 1px var(--mc-glass-edge),
      var(--mc-glass-shadow);
  }

  /* Graceful fallback: no backdrop-filter support → solid tinted panel. */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .glass { background: var(--mc-panel); box-shadow: var(--mc-glass-shadow); }
  }
  /* Frost to near-solid when the user prefers reduced transparency. */
  @media (prefers-reduced-transparency: reduce) {
    .glass {
      background: var(--mc-panel);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
  }
  /* High-contrast: solid surface with a defined edge for separation. */
  @media (prefers-contrast: more) {
    .glass {
      background: var(--mc-panel);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
      box-shadow: inset 0 0 0 1px var(--mc-border), var(--mc-glass-shadow);
    }
  }
`;
