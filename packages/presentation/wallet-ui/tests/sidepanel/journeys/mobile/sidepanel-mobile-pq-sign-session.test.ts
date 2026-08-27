/**
 * The paired-phone sign controller: the panel half of a clipboard round trip.
 *
 * The invariants worth protecting are all fail-closed ones. A paste that is not
 * a signature must be refused before the round trip, so the user is told the
 * response is wrong rather than that verification failed. A background refusal
 * must keep the prompt up with its reason, because nothing was submitted and the
 * request is still parked. And a re-poll must never reset a prompt the user is
 * part-way through, since a phone round trip outlives many dashboard repaints.
 */
import { describe, expect, test } from "bun:test";
import { mlDsa65Fixture } from "@mc-wallet/testkit/ml-dsa-fixtures";
import type { MobilePqSignRequestSummary } from "../../../../src/popup/responses/responses";
import {
  createMobilePqSignController,
  MOBILE_PQ_CANCELLED,
  MOBILE_PQ_PASTE_INVALID,
  type MobilePqSignOutcome,
  type MobilePqSignView,
} from "../../../../src/sidepanel/journeys/mobile/sign-session";

const device = mlDsa65Fixture(31);
const signature = device.sign("0x1e240");

const request: MobilePqSignRequestSummary = {
  accountId: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  deviceId: "phone-1",
  id: "mobile-pq-sign-1",
  messageHash: "0x1e240",
  publicKey: device.publicKey,
};

const harness = (report?: (outcome: MobilePqSignOutcome) => Promise<void>) => {
  const views: (MobilePqSignView | null)[] = [];
  const reported: MobilePqSignOutcome[] = [];
  const controller = createMobilePqSignController({
    render: (view) => views.push(view),
    report:
      report ??
      (async (outcome) => {
        reported.push(outcome);
      }),
  });
  return { controller, reported, views };
};

const latest = (views: readonly (MobilePqSignView | null)[]): MobilePqSignView | null =>
  views.at(-1) ?? null;

describe("createMobilePqSignController", () => {
  test("presenting renders the handoff with an envelope to carry to the phone", () => {
    const { controller, views } = harness();
    controller.present(request);
    const view = latest(views);
    expect(view?.phase).toEqual({ kind: "handoff" });
    expect(view?.request).toEqual(request);
    // The envelope is a single copyable string, and it commits to the hash.
    const envelope = view?.envelope ?? "";
    expect(envelope).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(atob(envelope.replaceAll("-", "+").replaceAll("_", "/"))).toContain(request.messageHash);
  });

  test("re-presenting the same request does not reset a prompt in progress", () => {
    const { controller, views } = harness();
    controller.present(request);
    const painted = views.length;
    controller.present(request);
    expect(views.length).toBe(painted);
  });

  test("a paste that is not a signature is refused before any round trip", async () => {
    const { controller, reported, views } = harness();
    controller.present(request);
    await controller.submit("not a signature");
    expect(reported).toEqual([]);
    expect(latest(views)?.phase).toEqual({ kind: "error", message: MOBILE_PQ_PASTE_INVALID });
    // The enrolled public key is the right length but the wrong thing entirely.
    await controller.submit(device.publicKey);
    expect(reported).toEqual([]);
    // And a truncated signature, which would otherwise read as a wrong device.
    await controller.submit(signature.slice(0, -2));
    expect(reported).toEqual([]);
  });

  test("surrounding whitespace from a clipboard paste is tolerated", async () => {
    const { controller, reported } = harness();
    controller.present(request);
    await controller.submit(`\n  ${signature}\n`);
    expect(reported).toEqual([{ id: request.id, signature }]);
  });

  test("a reported signature dismisses the prompt", async () => {
    const { controller, reported, views } = harness();
    controller.present(request);
    await controller.submit(signature);
    expect(reported).toEqual([{ id: request.id, signature }]);
    expect(latest(views)).toBe(null);
  });

  test("a background refusal keeps the prompt up with its reason", async () => {
    const { controller, views } = harness(async () => {
      throw new Error("Mobile signature verification failed");
    });
    controller.present(request);
    await controller.submit(signature);
    expect(latest(views)?.phase).toEqual({
      kind: "error",
      message: "Mobile signature verification failed",
    });
    // Nothing was submitted, so retry returns to the same parked request.
    controller.retry();
    expect(latest(views)?.phase).toEqual({ kind: "handoff" });
    expect(latest(views)?.request).toEqual(request);
  });

  test("cancelling reports a clean rejection so the held promise settles", async () => {
    const { controller, reported, views } = harness();
    controller.present(request);
    await controller.cancel();
    expect(reported).toEqual([{ error: MOBILE_PQ_CANCELLED, id: request.id }]);
    expect(latest(views)).toBe(null);
  });

  test("submitting twice reports once", async () => {
    let resolveReport: (() => void) | undefined;
    const { controller, reported } = harness(
      async (outcome) =>
        new Promise<void>((resolve) => {
          reported.push(outcome);
          resolveReport = resolve;
        }),
    );
    controller.present(request);
    const first = controller.submit(signature);
    await controller.submit(signature);
    resolveReport?.();
    await first;
    expect(reported).toHaveLength(1);
  });

  test("nothing happens without an active request", async () => {
    const { controller, reported, views } = harness();
    await controller.submit(signature);
    await controller.cancel();
    controller.retry();
    expect(reported).toEqual([]);
    expect(views).toEqual([]);
  });
});
