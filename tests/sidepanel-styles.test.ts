/**
 * Design-system stylesheet checks: press stability, token discipline, and
 * motion accessibility for the side panel UI.
 */
import { describe, expect, test } from "bun:test";
import { SIDEPANEL_STYLES } from "../src/sidepanel/styles";
import { MOTION } from "../src/ui/tokens";

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
});
