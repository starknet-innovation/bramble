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

  test("full-screen gutters are mirrored, so a classic scrollbar keeps the screen centred", () => {
    // A right-only gutter gave every screen a wider right margin on Windows (#795).
    expect(SIDEPANEL_STYLES).toMatch(/html \{[^}]*scrollbar-gutter: stable both-edges/s);
    expect(SIDEPANEL_STYLES).toMatch(
      /\.onboarding-step \{[^}]*scrollbar-gutter: stable both-edges/s,
    );
  });

  test("onboarding paints the landscape on the root and scrolls inside the mirrored gutter", () => {
    // The root gutter sits outside the body, so the flat tint showed beside the
    // landscape. The image moves to the root, which does not scroll, and the
    // body keeps the mirrored gutter so a long step does not shift the card.
    // The side panel has no onboarding-surface class, so its root gutter stays.
    expect(SIDEPANEL_STYLES).toMatch(
      /html:has\(body\.onboarding-surface\) \{[^}]*background-attachment: fixed[^}]*background-image: url\("brand\/onboarding-landscape\.webp"\)[^}]*overflow: hidden[^}]*scrollbar-gutter: auto/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /body\.onboarding-surface \{[^}]*background: transparent[^}]*overflow-y: auto[^}]*scrollbar-gutter: stable both-edges/s,
    );
  });
});
