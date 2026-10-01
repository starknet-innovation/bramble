/**
 * Surface-geometry checks for the side panel stylesheet: one corner radius per
 * surface role, one text column shared by headings, list rows, and cards, and
 * no double curves or broken edges where a fill meets its container. Each case
 * pins a defect found in partner UX review so a later change cannot quietly
 * reintroduce it.
 */
import { describe, expect, test } from "bun:test";
import { RADIUS, SPACE } from "@bramble/ui-kit/tokens";
import { SIDEPANEL_STYLES } from "../../../src/sidepanel/styles/index";

const CSS = SIDEPANEL_STYLES.replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of the first rule whose selector list is exactly `selector`. */
const rule = (selector: string): string => {
  for (const match of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((match[1] ?? "").trim().replace(/\s+/g, " ") === selector) return match[2] ?? "";
  }
  throw new Error(`No rule for ${selector}`);
};

describe("sidepanel surface geometry", () => {
  test("cards that stack on one screen share the card radius", () => {
    // A review reads as one stack: the summary, risk panel, fee card, and
    // disclosure beside it all round at the same step, as do the composer
    // cards and grouped lists. The risk panel once rounded tighter than the
    // fee card under it, and the composer cards rounder than their neighbours.
    for (const selector of [
      ".receipt",
      ".review-panel",
      ".callout",
      "details.disclosure",
      ".menu-list, .option-list",
      ".send-amount-card",
      ".send-review-summary",
      ".send-review-fee",
      ".send-review-disclosure",
    ]) {
      expect(rule(selector)).toContain(`border-radius: ${RADIUS.lg}`);
    }
    // The risk panel is a card, not a recessed well inside one: same fill and
    // text inset as the receipt and fee card it sits between.
    expect(rule(".review-panel")).toContain("background: var(--bramble-panel)");
    expect(rule(".review-panel")).toContain(`padding: ${SPACE.md} ${SPACE.lg}`);
  });

  test("the largest radius is reserved for full-page chrome", () => {
    const xl = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) => (match[2] ?? "").includes(`border-radius: ${RADIUS.xl}`))
      .map((match) => (match[1] ?? "").trim());
    expect(xl.sort()).toEqual([".onboarding-complete", ".onboarding-wizard"]);
  });

  test("rows inside a grouped card are square cells the card clips", () => {
    // A rounded fill inside a clipped card showed two curves: the card's at
    // its outer corner and the row's own against the next divider.
    expect(CSS).toMatch(
      /:is\(\.menu-list, \.option-list\) > :is\(button\.menu-row, a\.menu-row, button\.option-row, \.option-row-line\) \{\s*border-radius: 0;/,
    );
  });

  test("de-boxed list rows share the page column and bleed only their fill", () => {
    // Token and activity rows put their content on the text column of the
    // headings above them; the hover fill extends one step past it.
    for (const selector of [".token-row", ".tx-row"]) {
      const declarations = rule(selector);
      expect(declarations).toContain(`margin: 0 -${SPACE.sm}`);
      expect(declarations).toMatch(new RegExp(`padding: [^;]*${SPACE.sm}`));
    }
    expect(rule(".tx-day-label")).not.toContain("padding");
    expect(rule(".section-head")).not.toContain("padding");
  });

  test("a highlighted token row never runs into a divider", () => {
    expect(CSS).toMatch(
      /\.token-list > li\.token-row:hover::before, \.token-list > li\.token-row:hover \+ \.token-row::before \{ opacity: 0; \}/,
    );
  });

  test("Manage tokens keeps the token column when the list is absent", () => {
    // Hiding every balance renders the empty state and this row, with no
    // .token-list for a sibling selector to hang from.
    const row = rule(".home-tabs > button.menu-row");
    expect(row).toContain(`gap: ${SPACE.md}`);
    expect(row).toContain(`margin: 0 -${SPACE.sm}`);
    expect(row).toContain(`padding: 0 ${SPACE.sm}`);
    expect(rule(".home-tabs > button.menu-row .menu-icon")).toContain("width: 40px");
    expect(CSS).not.toContain(".token-list ~ button.menu-row");
  });

  test("a composite search field carries one continuous edge", () => {
    // The input's own bottom stroke stopped short of the icon and curled up at
    // the input's corner; the box owns the edge and the radius instead.
    const control = rule(".send-search-control");
    expect(control).toContain("border-bottom: 1px solid var(--bramble-border)");
    expect(control).toContain(`border-radius: ${RADIUS.md}`);
    const input = rule(".send-search-control input");
    expect(input).toContain("border-bottom: 0");
    expect(input).toContain("border-radius: 0");
  });

  test("the dock pill insets its roots equally on every side", () => {
    expect(rule(".wallet-dock")).toMatch(/padding: 6px;/);
  });

  test("dock screens reserve only the clearance the dock needs", () => {
    // Clearance plus the shell's bottom padding is exactly the dock footprint,
    // so a screen scrolls only once its content would reach the pill. Any
    // breathing gap on top scrolled screens whose content already cleared it.
    expect(rule(".screen:not(.flow)")).toContain(
      `padding-bottom: calc(var(--bramble-dock-h) - ${SPACE.md})`,
    );
  });

  test("an empty status line ending a dock screen takes no room", () => {
    // Home and Activity end on an empty live region. Its reserved line and the
    // gap before it were invisible space that pushed the page past the panel.
    // Out of flow, it stays in the document, so announcements still work.
    const trailing = rule(
      '.screen:not(.flow) > [role="status"]:empty:last-child, .screen:not(.flow) > :last-child > [role="status"]:empty:last-child',
    );
    expect(trailing).toContain("position: absolute");
    expect(trailing).not.toMatch(/display|visibility/);
    // Mid-screen status lines keep their reserved line so a message never
    // shifts the content below it.
    expect(rule('[role="status"]')).toContain("min-height: 16px");
  });

  test("a leading warning glyph keeps a gap from its sentence", () => {
    const danger = rule(".reveal-danger");
    expect(danger).toContain("display: flex");
    expect(danger).toContain(`gap: ${SPACE.sm}`);
  });
});
