/**
 * Design-system stylesheet checks: press stability, token discipline, and
 * motion accessibility for the side panel UI.
 */
import { describe, expect, test } from "bun:test";
import { SIDEPANEL_STYLES } from "../src/sidepanel/styles";
import { EASE, MOTION } from "../src/ui/tokens";

describe("sidepanel styles", () => {
  test("press and hover motion stays inside the lift/scale envelope", () => {
    // Feedback transforms are allowed but bounded: press scales stay within
    // 0.92–1.0 and hover/press lifts within 2px, so controls feel alive
    // without drifting under the pointer. Entrance keyframes are exempt.
    const pressBlocks = [...SIDEPANEL_STYLES.matchAll(/:(?:active|hover)[^{]*\{([^}]*)\}/g)].map(
      (match) => match[1] ?? "",
    );
    const scales = pressBlocks.flatMap((block) =>
      [...block.matchAll(/scale\((0?\.\d+|1)\)/g)].map((match) => Number(match[1])),
    );
    expect(scales.length).toBeGreaterThan(0);
    for (const scale of scales) {
      expect(scale).toBeGreaterThanOrEqual(0.92);
      expect(scale).toBeLessThanOrEqual(1);
    }
    const lifts = pressBlocks.flatMap((block) =>
      [...block.matchAll(/translateY\((-?\d+)px\)/g)].map((match) => Number(match[1])),
    );
    for (const lift of lifts) {
      expect(Math.abs(lift)).toBeLessThanOrEqual(2);
    }
  });

  test("interactive controls are borderless — structure comes from elevation", () => {
    expect(SIDEPANEL_STYLES).not.toMatch(/border:[^;]*solid/);
    expect(SIDEPANEL_STYLES).not.toMatch(/border:\s*\d*[1-9]/);
    expect(SIDEPANEL_STYLES).not.toContain("linear-gradient(");
    expect(SIDEPANEL_STYLES).not.toMatch(/\[aria-selected="true"\][^}]*transform/s);
  });

  test("reduced motion collapses every lift and press scale", () => {
    const reduced = SIDEPANEL_STYLES.slice(SIDEPANEL_STYLES.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain("animation: none");
    expect(reduced).toContain("transition: none");
    expect(reduced).toContain("transform: none");
  });

  test("colors come only from skin tokens, never literals", () => {
    expect(SIDEPANEL_STYLES).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(SIDEPANEL_STYLES).toContain("var(--mc-accent)");
    expect(SIDEPANEL_STYLES).toContain("var(--mc-bg)");
  });

  test("motion uses shared tokens and respects reduced-motion", () => {
    expect(SIDEPANEL_STYLES).toContain(MOTION.ease);
    expect(SIDEPANEL_STYLES).toContain(`${MOTION.pressMs}ms`);
    expect(SIDEPANEL_STYLES).toContain("prefers-reduced-motion");
    expect(SIDEPANEL_STYLES).toContain(":focus-visible");
  });

  test("screens only animate when the scene changes", () => {
    expect(SIDEPANEL_STYLES).toMatch(/\.shell-animate \.screen \{[^}]*animation/s);
    expect(SIDEPANEL_STYLES).not.toMatch(/(?<!-animate )\.screen \{[^}]*animation/s);
  });

  test("strong easing and spring easings reach the stylesheet as tokens", () => {
    // The redesign adds curves stronger than the legacy MOTION.ease/pop pair;
    // they must be published as custom properties so screens share one source.
    expect(SIDEPANEL_STYLES).toContain(`--ease-out: ${EASE.out}`);
    expect(SIDEPANEL_STYLES).toContain(`--ease-drawer: ${EASE.drawer}`);
    expect(SIDEPANEL_STYLES).toContain("--spring-drawer: linear(");
    expect(SIDEPANEL_STYLES).toContain("--spring-default: linear(");
    // Never expose an ease-in curve for UI motion (it delays the first frame).
    expect(SIDEPANEL_STYLES).not.toMatch(/:\s*ease-in\b/);
  });

  test("liquid glass is opt-in, token-driven, and degrades gracefully", () => {
    // The material is a single class surfaces opt into — real translucency plus
    // an inset specular highlight, not a border or gradient.
    expect(SIDEPANEL_STYLES).toMatch(/\.glass \{[^}]*backdrop-filter: blur/s);
    expect(SIDEPANEL_STYLES).toContain("inset 0 1px 0 var(--mc-glass-highlight)");
    // Graceful fallbacks: solid where backdrop-filter is unsupported, frosted
    // under reduced transparency, near-solid with an edge under more contrast.
    expect(SIDEPANEL_STYLES).toContain("@supports not ((backdrop-filter");
    expect(SIDEPANEL_STYLES).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(SIDEPANEL_STYLES).toContain("@media (prefers-contrast: more)");
  });

  test("view transitions are direction-aware and reduced-motion safe", () => {
    expect(SIDEPANEL_STYLES).toContain(
      'html[data-nav-direction="forward"]::view-transition-new(root)',
    );
    expect(SIDEPANEL_STYLES).toContain(
      'html[data-nav-direction="back"]::view-transition-old(root)',
    );
    expect(SIDEPANEL_STYLES).toContain(
      'html[data-nav-direction="swap"]::view-transition-new(root)',
    );
    // Transition motion collapses to a cut under reduced motion.
    expect(SIDEPANEL_STYLES).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*::view-transition-old\(root\)[^}]*animation: none/s,
    );
  });
});
