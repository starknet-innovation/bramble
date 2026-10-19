/**
 * Layout stability (#385, following #384): nothing a user does may change the
 * width a row is laid out at. Every container that scrolls on overflow reserves
 * its scrollbar gutter up front, so a classic scrollbar appearing never narrows
 * the rows inside it.
 */
import { describe, expect, test } from "bun:test";
import { SIDEPANEL_STYLES } from "../../../src/sidepanel/styles/index";

describe("scrollbar gutter", () => {
  test("every scrolling container reserves its gutter, so overflow never narrows its rows", () => {
    // The same shift as #384, one level down (#385): a picker, list or overlay
    // that scrolls on overflow summons a classic scrollbar the moment a filter,
    // an expanded row or a new phase makes it taller, and every row inside it
    // reflows narrower. Each such rule must reserve the gutter up front.
    const rules = [...SIDEPANEL_STYLES.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const scrolling = rules.filter(([, , body]) =>
      /(?:^|[;\s])overflow(?:-y)?:\s*(?:auto|scroll)\b/.test(body ?? ""),
    );
    expect(scrolling.length).toBeGreaterThanOrEqual(9);
    const unguarded = scrolling
      .filter(([, , body]) => !/scrollbar-gutter:\s*stable/.test(body ?? ""))
      .map(([, selector]) => (selector ?? "").trim());
    expect(unguarded).toEqual([]);
  });
});
