/**
 * The enrollment templates. These cover the one failure mode a pure-template
 * test can catch and a controller test cannot: a refusal that renders into the
 * DOM but is invisible to the person it is for.
 *
 * That happened. Both mobile journeys carried `class="form-error"`, which no
 * stylesheet defines, so the reason inherited `.ledger-phase-body > p` and was
 * painted in muted grey — the same treatment as "Preparing a fresh challenge",
 * directly under a heading that already said the attempt had failed. The text
 * was there and nobody could see it. So the assertion here is not that a message
 * appears, but that it appears in a class the stylesheet actually paints.
 */
import { describe, expect, test } from "bun:test";
import type { MobilePqEnrollView } from "../../../../src/sidepanel/journeys/mobile/onboard-session";
import { mobilePqEnrollScreen } from "../../../../src/sidepanel/journeys/mobile/onboard-views";
import { SIDEPANEL_STYLES } from "../../../../src/sidepanel/styles/index";

const CHALLENGE = "0x02f4c1a83b7e6d095c2a1f8b4e7d3c60a9f5e2b8d1c4a7f03e6b9d2c5a8f1e40";
const status = { network: "SN_DEVNET" } as never;
const screen = (phase: MobilePqEnrollView["phase"]): string =>
  mobilePqEnrollScreen({ challenge: CHALLENGE, phase }, status);

// Every class the templates put on a paragraph has to be one the stylesheet
// paints, or the paragraph is invisible in the only place it matters.
const styledClasses = new Set(
  [...SIDEPANEL_STYLES.matchAll(/\.([a-z][\w-]*)/g)].map((match) => match[1] as string),
);

describe("post-quantum enrollment screen", () => {
  test("renders a refusal in a class the stylesheet paints", () => {
    const html = screen({ kind: "error", message: "enrollment challenge expired" });
    expect(html).toContain("enrollment challenge expired");
    const classes = [...html.matchAll(/<p class="([^"]+)"/g)].flatMap((match) =>
      (match[1] as string).split(/\s+/),
    );
    expect(classes.length).toBeGreaterThan(0);
    for (const name of classes) {
      expect(styledClasses.has(name)).toBe(true);
    }
  });

  test("marks the refusal as danger rather than body copy", () => {
    const html = screen({ kind: "error", message: "device did not prove it holds this key" });
    // `review-flag` is the panel's one danger-text class; `.ledger-phase-body >
    // .review-flag` is what turns it red inside this card.
    expect(html).toContain('class="review-flag" role="alert"');
    expect(SIDEPANEL_STYLES).toContain(".ledger-phase-body > .review-flag");
  });

  test("keeps the form and the challenge available after a refusal", () => {
    const html = screen({ kind: "error", message: "no" });
    expect(html).toContain("data-mobile-pq-enroll-submit");
    expect(html).toContain(CHALLENGE);
  });

  test("asks for exactly the four fields the wallet cannot derive", () => {
    const html = screen({ kind: "collect" });
    for (const field of ["device", "public-key", "class-hash", "pop"]) {
      expect(html).toContain(`data-mobile-pq-${field}`);
    }
    // The key commitment is derived from the public key, so asking for it would
    // be asking the user to restate something the wallet already knows.
    expect(html).not.toContain("key-commitment");
  });
});
