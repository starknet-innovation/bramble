/**
 * The private-services notice (#443): a site's shadow-account request on a
 * network with no anonymizer is held on the wallet's surface until the user
 * closes it, and only Close delivers its refusal. If it is never closed, the
 * queue's expiry releases it exactly as any expired approval ("request
 * rejected") — never an answer that reveals the configuration, and never a hang.
 */
import { describe, expect, test } from "bun:test";
import {
  APPROVAL_TTL_MS,
  createApprovalQueue,
} from "../../../apps/extension/src/background/approvals/approvals";
import {
  createSignatureWaiters,
  DROPPED_APPROVAL_RESPONSE,
  releaseWaitersOnApprovalDrop,
} from "../../../apps/extension/src/background/approvals/signature-waiters";

const ORIGIN = "https://example.com";
const REFUSAL = { error: "strk20 services unavailable: no anonymizer" };

describe("private-services notice", () => {
  // Audit F5: expiry must look like any other expired approval. The notice's
  // own refusal (163, "no anonymizer") is delivered only when the user closes
  // it, so a site cannot learn the configuration by waiting out the TTL.
  test("expiry releases the held site exactly like an expired approval", async () => {
    const clock = { now: 1_700_000_000_000 };
    const approvals = createApprovalQueue({ now: () => clock.now });
    const waiters = createSignatureWaiters();
    releaseWaitersOnApprovalDrop(approvals, waiters, () => undefined);

    const notice = approvals.requestStrk20Unavailable({ origin: ORIGIN, refusal: REFUSAL.error });
    expect(notice.kind).toBe("strk20-unavailable");
    expect(approvals.payload(notice.id)).toEqual({ noticeRefusal: REFUSAL.error });
    const held = waiters.register(notice.id);
    const second = waiters.register(notice.id);

    clock.now += APPROVAL_TTL_MS + 1;
    expect(approvals.list()).toEqual([]);
    expect(await held).toEqual(DROPPED_APPROVAL_RESPONSE);
    expect(await second).toEqual(DROPPED_APPROVAL_RESPONSE);
    expect(waiters.pending()).toBe(0);
  });

  test("an ordinary approval still drops as a refusal by the user", async () => {
    const waiters = createSignatureWaiters();
    const held = waiters.register("a");
    waiters.release("a");
    expect(await held).toEqual(DROPPED_APPROVAL_RESPONSE);
  });

  test("the notice refuses an unknown origin", () => {
    expect(() =>
      createApprovalQueue().requestStrk20Unavailable({ origin: "nope", refusal: REFUSAL.error }),
    ).toThrow("Invalid origin");
  });
});
