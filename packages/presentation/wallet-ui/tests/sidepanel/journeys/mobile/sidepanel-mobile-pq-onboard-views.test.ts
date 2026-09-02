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
const screen = (
  phase: MobilePqEnrollView["phase"],
  transport: MobilePqEnrollView["transport"] = "clipboard",
  bluetoothAvailable = false,
): string =>
  mobilePqEnrollScreen(
    { bluetoothAvailable, challenge: CHALLENGE, offer: "b2ZmZXI", phase, transport },
    status,
  );

// Every class the templates put on a paragraph has to be one the stylesheet
// paints, or the paragraph is invisible in the only place it matters.
const styledClasses = new Set(
  [...SIDEPANEL_STYLES.matchAll(/\.([a-z][\w-]*)/g)].map((match) => match[1] as string),
);

describe("post-quantum enrollment screen", () => {
  test("the challenge is for comparing, never for copying", () => {
    // On both paths. It exists so the user can check it against the phone, and
    // a copy button beside it only invites moving the wrong value.
    for (const transport of ["bluetooth", "clipboard"] as const) {
      const html = screen({ kind: "collect" }, transport, true);
      expect(html).toContain("Challenge to sign");
      expect(html).toContain(CHALLENGE);
      expect(html).not.toContain(`data-copy="${CHALLENGE}"`);
    }
  });

  test("the Bluetooth path shows no offer to copy", () => {
    const html = screen({ kind: "collect" }, "bluetooth", true);

    expect(html).toContain("data-mobile-pq-enroll-bluetooth");
    expect(html).toContain("data-mobile-pq-enroll-cancel");
    expect(html).toContain("data-mobile-pq-enroll-use-clipboard");
    // Single-use and 14 KB: on screen only when the user is carrying it.
    expect(html).not.toContain('data-copy="b2ZmZXI"');
    expect(html).not.toContain("data-mobile-pq-response");
  });

  test("the copy-and-paste path shows the offer and a way back", () => {
    const html = screen({ kind: "collect" }, "clipboard", true);

    expect(html).toContain('data-copy="b2ZmZXI"');
    expect(html).toContain("data-mobile-pq-response");
    expect(html).toContain("data-mobile-pq-enroll-submit");
    expect(html).toContain("data-mobile-pq-enroll-use-bluetooth");
  });

  test("with no Bluetooth there is no choice to offer", () => {
    const html = screen({ kind: "collect" }, "clipboard", false);

    expect(html).toContain("data-mobile-pq-response");
    expect(html).not.toContain("data-mobile-pq-enroll-use-bluetooth");
    expect(html).not.toContain("data-mobile-pq-enroll-use-clipboard");
  });

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

  test("asks for one paste and nothing the wallet can derive or pin", () => {
    const html = screen({ kind: "collect" });
    expect(html).toContain("data-mobile-pq-response");
    // Everything that used to be a field: the name, the key and the signature
    // all arrive inside the reply; the class hash is pinned like Argent's; and
    // the key commitment is derived from the public key. Asking for any of them
    // would be asking the user to restate something already known.
    for (const gone of ["device", "public-key", "class-hash", "pop", "key-commitment"]) {
      expect(html).not.toContain(`data-mobile-pq-${gone}`);
    }
  });
});
