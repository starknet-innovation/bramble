/**
 * The enrollment templates. These cover the failure modes a pure-template test
 * can catch and a controller test cannot: a refusal that renders into the DOM
 * but is invisible to the person it is for, and a challenge spelled differently
 * from the way the phone spells it.
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

// The challenge is rendered in groups of four, so the digits are only contiguous
// once the grouping spans come out. Same treatment the sign-view test uses.
const ungrouped = (html: string): string => html.replaceAll("<span>", "").replaceAll("</span>", "");
const status = { network: "SN_DEVNET" } as never;
const screen = (
  phase: MobilePqEnrollView["phase"],
  transport: MobilePqEnrollView["transport"] = "clipboard",
  bluetoothAvailable = false,
  restoreAvailable = false,
): string =>
  mobilePqEnrollScreen(
    {
      bluetoothAvailable,
      challenge: CHALLENGE,
      offer: "b2ZmZXI",
      phase,
      restoreAvailable,
      transport,
    },
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
      expect(ungrouped(html)).toContain(CHALLENGE);
      expect(html).not.toContain(`data-copy="${CHALLENGE}"`);
    }
  });

  test("the challenge is padded to the width the phone signs and shows", () => {
    // The phone pads the challenge to 32 big-endian bytes before signing, and
    // displays what it signed. A wallet that printed the wallet's own shorter
    // spelling made the two screens disagree about the value on every felt with
    // a leading zero — on the screen whose only job is asking "do these match?".
    const html = ungrouped(
      mobilePqEnrollScreen(
        {
          bluetoothAvailable: false,
          challenge: "0x2f",
          offer: "b2ZmZXI",
          phase: { kind: "collect" },
          restoreAvailable: false,
          transport: "clipboard",
        },
        status,
      ),
    );

    expect(html).toContain(`0x${"0".repeat(62)}2f`);
  });

  test("the challenge is grouped like the hash on the signing screen", () => {
    const html = screen({ kind: "collect" });

    // Groups of four, the Ledger takeover's treatment, so a 64-digit value can
    // be tracked across two screens by eye.
    expect(html).toContain("<span>02f4</span><span>c1a8</span>");
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
    expect(ungrouped(html)).toContain(CHALLENGE);
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

/**
 * The restore screen. Its one job beyond listing accounts is telling the user
 * why they are about to be asked for several biometric approvals — without that
 * the second prompt looks like the first one failed.
 */
describe("post-quantum restore screen", () => {
  const withRestore = (
    phase: MobilePqEnrollView["phase"],
    restore: MobilePqEnrollView["restore"],
  ): string =>
    mobilePqEnrollScreen(
      {
        bluetoothAvailable: true,
        challenge: CHALLENGE,
        offer: "b2ZmZXI",
        phase,
        ...(restore === undefined ? {} : { restore }),
        restoreAvailable: true,
        transport: "bluetooth",
      },
      status,
    );

  test("the restore control shows only where it can work", () => {
    // It needs the Bluetooth driver: a restore is one round trip per account,
    // and the clipboard path cannot carry that.
    expect(screen({ kind: "collect" }, "bluetooth", true, true)).toContain(
      "data-mobile-pq-enroll-restore",
    );
    expect(screen({ kind: "collect" }, "bluetooth", true, false)).not.toContain(
      "data-mobile-pq-enroll-restore",
    );
    expect(screen({ kind: "collect" }, "clipboard", true, true)).not.toContain(
      "data-mobile-pq-enroll-restore",
    );
  });

  test("an account already in the wallet is not reported as a failure", () => {
    const html = withRestore({ kind: "restoring" }, [
      { deviceId: "Pixel 9 Pro", outcome: "present" },
    ]);
    expect(html).toContain("already in this wallet");
  });

  test("a skipped account with no reason still reads as skipped", () => {
    // The case a default gets wrong: it must not read as one still pending.
    const html = withRestore({ kind: "restoring" }, [{ deviceId: "a", outcome: "skipped" }]);
    expect(html).toContain("skipped");
    expect(html).not.toContain("waiting for your phone");
  });

  test("the running tally and each account's reason are both on screen", () => {
    const html = withRestore({ kind: "restoring" }, [
      { deviceId: "a", outcome: "restored" },
      { deviceId: "b", outcome: "skipped", reason: "Your phone declined the request." },
      { deviceId: "c" },
    ]);
    expect(html).toContain("Restored 1 of 3, 1 skipped.");
    expect(html).toContain("Your phone declined the request.");
  });

  test("says every account needs its own approval, and names each one", () => {
    const html = withRestore({ kind: "restoring" }, [
      { deviceId: "Pixel 9 Pro", outcome: "restored" },
      { deviceId: "Spare phone" },
    ]);
    expect(html).toContain("its own biometric check");
    expect(html).toContain("Pixel 9 Pro");
    expect(html).toContain("Spare phone");
    // The one still to come is not claimed as finished.
    expect(html).toContain('data-outcome="pending"');
  });

  test("a device name is escaped, never rendered as markup", () => {
    const html = withRestore({ kind: "restoring" }, [
      { deviceId: "<img src=x onerror=alert(1)>", outcome: "skipped" },
    ]);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  test("before the phone answers, the picker is what the screen asks for", () => {
    expect(withRestore({ kind: "restoring" }, [])).toContain(
      "Pick the accounts to restore on your phone.",
    );
  });
});
