/**
 * The pure paired-phone prompt template. The phone blind-signs at this
 * milestone, so this screen is the only place the hash a signature commits to is
 * visible — these assert it renders in every phase, at full padded width, and
 * that dynamic text is escaped.
 */
import { describe, expect, test } from "bun:test";
import { mlDsa65Fixture } from "@mc-wallet/testkit/ml-dsa-fixtures";
import { paddedFelt } from "@mc-wallet/wallet-model/networks";
import type {
  MobilePqSignRequestSummary,
  WalletStatus,
} from "../../../../src/popup/responses/responses";
import { encodeMobilePqSignEnvelope } from "../../../../src/sidepanel/journeys/mobile/sign-envelope";
import type { MobilePqSignView } from "../../../../src/sidepanel/journeys/mobile/sign-session";
import { mobilePqSignScreen } from "../../../../src/sidepanel/journeys/mobile/sign-views";

const device = mlDsa65Fixture(41);

const request: MobilePqSignRequestSummary = {
  accountId: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  deviceId: "phone-1",
  id: "mobile-pq-sign-1",
  messageHash: "0xabc",
  networkId: "SN_MAIN",
  publicKey: device.publicKey,
};

const status: WalletStatus = {
  accountCount: 1,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const render = (
  phase: MobilePqSignView["phase"],
  transport: MobilePqSignView["transport"] = "clipboard",
  bluetoothAvailable = false,
): string =>
  mobilePqSignScreen(
    {
      bluetoothAvailable,
      envelope: encodeMobilePqSignEnvelope(request),
      phase,
      request,
      transport,
    },
    status,
  );

describe("mobilePqSignScreen", () => {
  test("the Bluetooth path shows the hash and no request to copy", () => {
    const html = render({ kind: "handoff" }, "bluetooth", true);

    expect(html).toContain("data-mobile-pq-bluetooth");
    expect(html).toContain("Hash your phone will sign");
    // The envelope is the wallet's to carry here. Putting kilobytes of
    // base64url on screen beside a button that needs none of it buries the
    // hash, which is the only thing the user has to check.
    expect(html).not.toContain(`data-copy="${encodeMobilePqSignEnvelope(request)}"`);
    expect(html).not.toContain("data-mobile-pq-response");
    expect(html).toContain("data-mobile-pq-use-clipboard");
  });

  test("the copy-and-paste path shows the request and a way back", () => {
    const html = render({ kind: "handoff" }, "clipboard", true);

    expect(html).toContain(`data-copy="${encodeMobilePqSignEnvelope(request)}"`);
    expect(html).toContain("data-mobile-pq-response");
    expect(html).toContain("data-mobile-pq-submit");
    expect(html).toContain("data-mobile-pq-use-bluetooth");
    // The hash comparison is on every path: it is what the phone cannot show.
    expect(html).toContain("Hash your phone will sign");
  });

  test("with no Bluetooth there is no choice to offer", () => {
    const html = render({ kind: "handoff" }, "clipboard", false);

    expect(html).toContain("data-mobile-pq-response");
    expect(html).not.toContain("data-mobile-pq-use-bluetooth");
    expect(html).not.toContain("data-mobile-pq-use-clipboard");
  });

  test("the handoff offers both halves of the round trip at once", () => {
    const html = render({ kind: "handoff" });
    expect(html).toContain("Approve on your phone");
    expect(html).toContain(`data-copy="${encodeMobilePqSignEnvelope(request)}"`);
    expect(html).toContain("data-mobile-pq-response");
    expect(html).toContain("data-mobile-pq-submit");
    expect(html).toContain("data-mobile-pq-cancel");
    expect(html).toContain("phone-1");
    expect(html).toContain("Starknet Mainnet");
  });

  test("the hash is shown at full padded width in every phase", () => {
    const padded = paddedFelt(request.messageHash) as string;
    expect(padded.length).toBe(66);
    for (const phase of [
      { kind: "handoff" } as const,
      { kind: "submitting" } as const,
      { kind: "error", message: "nope" } as const,
    ]) {
      const html = render(phase);
      // Grouped for comparison, so assert on the digits with the grouping spans
      // stripped rather than on the raw run.
      expect(html.replaceAll("<span>", "").replaceAll("</span>", "")).toContain(padded);
      // Shown for comparison, deliberately NOT copyable. The app cannot read a
      // bare hash, so offering to copy one only invites pasting the wrong thing;
      // the signing request above it is what the app reads.
      expect(html).not.toContain(`data-copy="${padded}"`);
    }
  });

  test("the signing request is the only thing offered for copying", () => {
    const html = render({ kind: "handoff" });
    expect(html).toContain("Copy signing request");
    expect(html).not.toContain("Copy transaction hash");
  });

  test("the hash to compare comes before the request to copy", () => {
    const html = render({ kind: "handoff" }, "clipboard", true);
    // Inverted deliberately when Bluetooth landed. The old order put the
    // copyable request first, to stop a user working top-down from copying the
    // hash instead — a hazard that no longer exists, because the hash block has
    // no copy control at all (pinned by the test above). What is left is that
    // comparing the hash is the user's job on EVERY path, while the request is
    // only ever on screen when they are carrying it by hand.
    expect(html.indexOf("Hash your phone will sign")).toBeGreaterThan(-1);
    expect(html.indexOf("Hash your phone will sign")).toBeLessThan(
      html.indexOf("Request for your phone"),
    );
  });

  test("only the handoff offers the request; the hash stays in every phase", () => {
    for (const phase of [
      { kind: "submitting" } as const,
      { kind: "error", message: "no" } as const,
    ]) {
      const html = render(phase);
      expect(html).not.toContain("Copy signing request");
      expect(html).toContain("Hash your phone will sign");
    }
  });

  test("submitting never claims the signature is accepted", () => {
    const html = render({ kind: "submitting" });
    expect(html).toContain("verifying it against this account's enrolled key");
    // No affordance to submit again while the round trip is in flight.
    expect(html).not.toContain("data-mobile-pq-submit");
  });

  test("an error offers retry and says nothing was broadcast", () => {
    const html = render({ kind: "error", message: "Mobile signature verification failed" });
    expect(html).toContain("Mobile signature verification failed");
    expect(html).toContain("data-mobile-pq-retry");
    expect(html).toContain("has not been signed or broadcast");
  });

  test("dynamic text is escaped", () => {
    const html = render({ kind: "error", message: '<img src=x onerror="alert(1)">' });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});
