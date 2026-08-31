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
  MOBILE_PQ_CLASS_INVALID,
  MOBILE_PQ_DEVICE_INVALID,
  MOBILE_PQ_KEY_INVALID,
  MOBILE_PQ_POP_INVALID,
  type MobilePqEnrollDraft,
  type MobilePqEnrollView,
} from "../../../../src/sidepanel/journeys/mobile/onboard-session";

const CHALLENGE = "0x1e240";
const device = mlDsa65Fixture(61);

const draft: MobilePqEnrollDraft = {
  classHash: "0xabc",
  deviceId: "Pixel 9 Pro",
  publicKey: device.publicKey,
  signature: device.sign(CHALLENGE),
};

const harness = (overrides?: {
  readonly challenge?: () => Promise<string>;
  readonly enroll?: (input: unknown) => Promise<void>;
}) => {
  const views: (MobilePqEnrollView | null)[] = [];
  const enrolled: unknown[] = [];
  let refreshed = 0;
  const controller = createMobilePqEnrollController({
    challenge: overrides?.challenge ?? (async () => CHALLENGE),
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
    await controller.submit(draft);
    expect(enrolled).toEqual([{ ...draft, challenge: CHALLENGE }]);
    expect(latest(views)).toBe(null);
    expect(refreshed()).toBe(1);
  });

  test("refuses every malformed field before any round trip", async () => {
    const cases: readonly (readonly [Partial<MobilePqEnrollDraft>, string])[] = [
      [{ deviceId: "" }, MOBILE_PQ_DEVICE_INVALID],
      [{ publicKey: "0x456" }, MOBILE_PQ_KEY_INVALID],
      // The right length, but a signature rather than a key.
      [{ publicKey: draft.signature }, MOBILE_PQ_KEY_INVALID],
      [{ classHash: "0x0" }, MOBILE_PQ_CLASS_INVALID],
      [{ signature: "0xab" }, MOBILE_PQ_POP_INVALID],
      // The right length, but a key rather than a signature.
      [{ signature: draft.publicKey }, MOBILE_PQ_POP_INVALID],
    ];
    for (const [patch, message] of cases) {
      const { controller, enrolled, views } = harness();
      await controller.open();
      await controller.submit({ ...draft, ...patch });
      expect(enrolled).toEqual([]);
      expect(latest(views)?.phase).toEqual({ kind: "error", message });
    }
  });

  test("a refused enrollment keeps the form up with the reason and no account", async () => {
    const { controller, refreshed, views } = harness({
      enroll: async () => {
        throw new Error("device did not prove it holds this key");
      },
    });
    await controller.open();
    await controller.submit(draft);
    expect(latest(views)?.phase).toEqual({
      kind: "error",
      message: "device did not prove it holds this key",
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
    const first = controller.submit(draft);
    await controller.submit(draft);
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
