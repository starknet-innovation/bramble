/**
 * Design-system stylesheet checks: press stability, token discipline, and
 * motion accessibility for the side panel UI.
 */
import { describe, expect, test } from "bun:test";
import { SIDEPANEL_STYLES } from "../src/sidepanel/styles";
import { MOTION } from "../src/ui/tokens";

describe("sidepanel styles", () => {
  test("controls never move on press or hover", () => {
    expect(SIDEPANEL_STYLES).not.toMatch(/:active[^}]*transform/s);
    expect(SIDEPANEL_STYLES).not.toMatch(/:hover[^}]*transform/s);
    expect(SIDEPANEL_STYLES).not.toContain("scale(");
    expect(SIDEPANEL_STYLES).not.toMatch(/transition:[^;]*transform/s);
  });

  test("interactive controls keep a constant border in every state", () => {
    expect(SIDEPANEL_STYLES).toMatch(/button \{[^}]*border: 1px solid/s);
    expect(SIDEPANEL_STYLES).not.toMatch(/:active[^}]*border-width/s);
    expect(SIDEPANEL_STYLES).not.toMatch(/\[aria-selected="true"\][^}]*border-width/s);
    expect(SIDEPANEL_STYLES).not.toMatch(/\[aria-pressed="true"\][^}]*border-width/s);
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
