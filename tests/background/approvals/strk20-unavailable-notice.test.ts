/**
 * The private-services notice (#443): a site's shadow-account request on a
 * network with no anonymizer is held on the wallet's surface until the user
 * closes it. If it is never closed, the queue's expiry releases it with the
 * same refusal the site would get on close — never a different answer a site
 * could tell apart, and never a hang.
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
  test("expiry releases the held site with the notice's own refusal", async () => {
    const clock = { now: 1_700_000_000_000 };
    const approvals = createApprovalQueue({ now: () => clock.now });
    const waiters = createSignatureWaiters();
    releaseWaitersOnApprovalDrop(approvals, waiters, () => undefined);

    const notice = approvals.requestStrk20Unavailable({ origin: ORIGIN, refusal: REFUSAL.error });
    expect(notice.kind).toBe("strk20-unavailable");
    expect(approvals.payload(notice.id)).toEqual({ noticeRefusal: REFUSAL.error });
    const held = waiters.register(notice.id, REFUSAL);
    // A second tab parked on the same id cannot replace the drop response.
    const second = waiters.register(notice.id, DROPPED_APPROVAL_RESPONSE);

    clock.now += APPROVAL_TTL_MS + 1;
    expect(approvals.list()).toEqual([]);
    expect(await held).toEqual(REFUSAL);
    expect(await second).toEqual(REFUSAL);
    expect(waiters.pending()).toBe(0);
  });

  test("an ordinary approval still drops as a refusal by the user", async () => {
    const waiters = createSignatureWaiters();
    const held = waiters.register("a");
    waiters.release("a");
    expect(await held).toEqual(DROPPED_APPROVAL_RESPONSE);
  });

  test("a settled notice leaves no drop response behind for a reused id", async () => {
    const waiters = createSignatureWaiters();
    const first = waiters.register("a", REFUSAL);
    waiters.settle("a", { error: "closed" });
    expect(await first).toEqual({ error: "closed" });
    const next = waiters.register("a");
    waiters.release("a");
    expect(await next).toEqual(DROPPED_APPROVAL_RESPONSE);
  });

  test("the notice refuses an unknown origin", () => {
    expect(() =>
      createApprovalQueue().requestStrk20Unavailable({ origin: "nope", refusal: REFUSAL.error }),
    ).toThrow("Invalid origin");
  });
});
