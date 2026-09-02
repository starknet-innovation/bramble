/**
 * Enrolling a paired post-quantum device. The invariant that matters is the
 * order: the wallet issues a challenge, the device signs it, and only a device
 * that can sign for the key it pastes gets an account. An address derived from a
 * key the device cannot sign for is unspendable, and anything funded there is
 * lost — so every path that would enroll without that proof must refuse.
 */
import { describe, expect, test } from "bun:test";
import { mlDsa65Fixture } from "@mc-wallet/testkit/ml-dsa-fixtures";
import {
  createMobilePqEnrollController,
  MOBILE_PQ_CHALLENGE_SPENT,
  MOBILE_PQ_KEY_INVALID,
  MOBILE_PQ_PAIRING_PASTE_INVALID,
  MOBILE_PQ_PAIRING_VERSION,
  MOBILE_PQ_POP_INVALID,
  type MobilePqEnrollDraft,
  type MobilePqEnrollView,
} from "../../../../src/sidepanel/journeys/mobile/onboard-session";
import {
  fromBase64Url,
  toBase64Url,
} from "../../../../src/sidepanel/journeys/mobile/wire-encoding";

const CHALLENGE = "0x1e240";
const device = mlDsa65Fixture(61);

const draft: MobilePqEnrollDraft = {
  deviceId: "Pixel 9 Pro",
  publicKey: device.publicKey,
  signature: device.sign(CHALLENGE),
};

/**
 * The phone's reply as the user pastes it. Built here rather than imported: the
 * wallet only ever decodes one, so an encoder in production code would be dead.
 */
const reply = (patch: Partial<MobilePqEnrollDraft> = {}): string =>
  toBase64Url(JSON.stringify({ ...draft, ...patch, version: MOBILE_PQ_PAIRING_VERSION }));

const harness = (overrides?: {
  readonly challenge?: () => Promise<string>;
  readonly enroll?: (input: unknown) => Promise<void>;
}) => {
  const views: (MobilePqEnrollView | null)[] = [];
  const enrolled: unknown[] = [];
  let refreshed = 0;
  const controller = createMobilePqEnrollController({
    challenge: overrides?.challenge ?? (async () => CHALLENGE),
    networkId: () => "SN_SEPOLIA",
    enroll:
      overrides?.enroll ??
      (async (input) => {
        enrolled.push(input);
      }),
    onEnrolled: async () => {
      refreshed += 1;
    },
    render: (view) => views.push(view),
  });
  return { controller, enrolled, refreshed: () => refreshed, views };
};

const latest = (views: readonly (MobilePqEnrollView | null)[]): MobilePqEnrollView | null =>
  views.at(-1) ?? null;

describe("createMobilePqEnrollController", () => {
  test("opens on a freshly issued challenge", async () => {
    const { controller, views } = harness();
    await controller.open();
    const view = latest(views);
    expect(view?.challenge).toBe(CHALLENGE);
    expect(view?.phase).toEqual({ kind: "collect" });
  });

  test("shows nothing when no challenge could be issued", async () => {
    const { controller, views } = harness({
      challenge: async () => {
        throw new Error("offline");
      },
    });
    await expect(controller.open()).rejects.toThrow("offline");
    // A form with no challenge cannot succeed, so it is not offered.
    expect(latest(views)).toBe(null);
  });

  test("enrolls with the issued challenge", async () => {
    const { controller, enrolled, refreshed, views } = harness();
    await controller.open();
    await controller.submit(reply());
    expect(enrolled).toEqual([{ ...draft, challenge: CHALLENGE }]);
    expect(latest(views)).toBe(null);
    expect(refreshed()).toBe(1);
  });

  test("refuses every malformed field before any round trip", async () => {
    const cases: readonly (readonly [Partial<MobilePqEnrollDraft>, string])[] = [
      [{ publicKey: "0x456" }, MOBILE_PQ_KEY_INVALID],
      // The right length, but a signature rather than a key.
      [{ publicKey: draft.signature }, MOBILE_PQ_KEY_INVALID],
      [{ signature: "0xab" }, MOBILE_PQ_POP_INVALID],
      // The right length, but a key rather than a signature.
      [{ signature: draft.publicKey }, MOBILE_PQ_POP_INVALID],
    ];
    for (const [patch, message] of cases) {
      const { controller, enrolled, views } = harness();
      await controller.open();
      await controller.submit(reply(patch));
      expect(enrolled).toEqual([]);
      expect(latest(views)?.phase).toEqual({ kind: "error", message });
    }
  });

  test("a paste that is not a pairing reply is refused before any field check", async () => {
    // A different problem from "that key is the wrong length": the user copied
    // the wrong thing, or copied half of it. Saying which sends them to the
    // right place.
    const notReplies = [
      "",
      "not base64url at all!!",
      toBase64Url("{}"),
      toBase64Url(JSON.stringify({ ...draft, version: 99 })),
      // The app always names a key, so an empty name is a broken reply, not a
      // field the user can fill in.
      toBase64Url(JSON.stringify({ ...draft, deviceId: "", version: MOBILE_PQ_PAIRING_VERSION })),
      // Structurally a reply, but truncated mid-value.
      toBase64Url(JSON.stringify({ ...draft, version: MOBILE_PQ_PAIRING_VERSION })).slice(0, 12),
    ];
    for (const pasted of notReplies) {
      const { controller, enrolled, views } = harness();
      await controller.open();
      await controller.submit(pasted);
      expect(enrolled).toEqual([]);
      expect(latest(views)?.phase).toEqual({
        kind: "error",
        message: MOBILE_PQ_PAIRING_PASTE_INVALID,
      });
    }
  });

  test("the offer the user copies names the network and carries the challenge", async () => {
    const { controller, views } = harness();
    await controller.open();
    const offer = latest(views)?.offer ?? "";
    expect(JSON.parse(fromBase64Url(offer) ?? "null")).toEqual({
      challenge: CHALLENGE,
      networkId: "SN_SEPOLIA",
      version: MOBILE_PQ_PAIRING_VERSION,
    });
  });

  test("a refused enrollment keeps the form up with the reason and no account", async () => {
    const { controller, refreshed, views } = harness({
      enroll: async () => {
        throw new Error("device did not prove it holds this key");
      },
    });
    await controller.open();
    await controller.submit(reply());
    // The remedy is appended to every background refusal, not just an expired
    // one: the challenge is consumed before the proof of possession is checked,
    // so any refusal leaves the form on screen unable to succeed.
    expect(latest(views)?.phase).toEqual({
      kind: "error",
      message: `device did not prove it holds this key. ${MOBILE_PQ_CHALLENGE_SPENT}`,
    });
    expect(refreshed()).toBe(0);
    // The challenge is single-use, so what is on screen is no longer usable.
    expect(latest(views)?.challenge).toBe(CHALLENGE);
  });

  test("submitting twice enrolls once", async () => {
    let release: (() => void) | undefined;
    const { controller, enrolled } = harness({
      enroll: async (input) =>
        new Promise<void>((resolve) => {
          enrolled.push(input);
          release = resolve;
        }),
    });
    await controller.open();
    const first = controller.submit(reply());
    await controller.submit(reply());
    release?.();
    await first;
    expect(enrolled).toHaveLength(1);
  });

  test("cancelling closes without enrolling", async () => {
    const { controller, enrolled, views } = harness();
    await controller.open();
    controller.cancel();
    expect(latest(views)).toBe(null);
    expect(enrolled).toEqual([]);
  });
});
