/**
 * The approval queue's admission rules, Sherlock 128, 151 and 157.
 *
 * - 128: at the global cap a new origin may displace a prompt only from an
 *   origin holding more than one, so colluding origins holding one prompt each
 *   cannot drop the prompt the user is reviewing.
 * - 151: a request admitted to expensive pre-queue work holds a reservation
 *   that counts against the caps until it queues, so concurrent requests
 *   cannot all pass admission first.
 * - 157: an approval the side panel could not display is refused at enqueue
 *   instead of sitting in the queue with no card.
 */
import { describe, expect, test } from "bun:test";
import {
  APPROVAL_TOO_LARGE,
  withApprovalReservation,
} from "../../../apps/extension/src/background/approvals/approval-limits";
import {
  type ApprovalQueue,
  createApprovalQueue,
  MAX_PENDING_APPROVALS,
  MAX_PENDING_APPROVALS_PER_ORIGIN,
} from "../../../apps/extension/src/background/approvals/approvals";
import { readPendingApprovals } from "../../../packages/presentation/wallet-ui/src/popup/responses/approvals-responses";

const VICTIM = "https://victim.example";
const NEWCOMER = "https://newcomer.example";
const GLOBAL_REFUSAL = /^Too many pending approvals$/;
const ORIGIN_REFUSAL = /^Too many pending approvals for this site$/;
const CONTEXT = {
  accountId: "SN_MAIN:0x1",
  chainId: "0x534e5f4d41494e",
  networkId: "SN_MAIN" as const,
  payloadDigest: `sha256:${"a".repeat(64)}`,
};
const NO_FEE = {
  fee: null,
  feeAffordability: "unknown",
  feeEstimateFailed: false,
  feeEstimatePending: false,
  requiresDeployment: false,
} as const;

const colluder = (index: number): string => `https://colluder-${index}.example`;

const invoke = (queue: ApprovalQueue, origin: string, felts: number) =>
  queue.requestInvoke({
    calls: [
      {
        calldata: Array.from({ length: felts }, () => `0x${"7".repeat(63)}`),
        contractAddress: "0x1",
        entrypoint: "transfer",
      },
    ],
    context: CONTEXT,
    fee: NO_FEE,
    flags: [],
    origin,
    summaries: ["Invoke"],
  });

describe("capacity eviction (Sherlock 128)", () => {
  test("colluding origins holding one prompt each cannot drop another site's prompt", () => {
    const queue = createApprovalQueue();
    const reviewing = queue.request(VICTIM);
    for (let index = 1; index < MAX_PENDING_APPROVALS; index += 1) {
      queue.request(colluder(index));
    }
    const dropped: string[] = [];
    queue.observeDrops((ids) => dropped.push(...ids));

    expect(queue.canAdmit(NEWCOMER)).toMatch(GLOBAL_REFUSAL);
    expect(() => queue.request(NEWCOMER)).toThrow(GLOBAL_REFUSAL);
    expect(queue.get(reviewing.id)).toEqual(reviewing);
    expect(dropped).toEqual([]);
  });

  test("a new origin still displaces the oldest prompt of an origin holding several", () => {
    const queue = createApprovalQueue();
    const reviewing = queue.request(VICTIM);
    const heavy = "https://heavy.example";
    const heavyFirst = invoke(queue, heavy, 1);
    invoke(queue, heavy, 1);
    for (let index = 3; index < MAX_PENDING_APPROVALS; index += 1) {
      queue.request(colluder(index));
    }

    expect(queue.canAdmit(NEWCOMER)).toBeNull();
    const admitted = queue.request(NEWCOMER);
    expect(queue.get(admitted.id)).toEqual(admitted);
    expect(queue.get(heavyFirst.id)).toBeNull();
    expect(queue.get(reviewing.id)).toEqual(reviewing);
  });
});

describe("admission reservations (Sherlock 151)", () => {
  test("count against the per-origin cap until released", () => {
    const queue = createApprovalQueue();
    const releases = Array.from({ length: MAX_PENDING_APPROVALS_PER_ORIGIN }, () =>
      queue.reserve(VICTIM),
    );
    expect(queue.canAdmit(VICTIM)).toMatch(ORIGIN_REFUSAL);
    expect(() => queue.reserve(VICTIM)).toThrow(ORIGIN_REFUSAL);
    expect(queue.canAdmit(NEWCOMER)).toBeNull();

    releases[0]?.();
    releases[0]?.();
    expect(queue.canAdmit(VICTIM)).toBeNull();
    const again = queue.reserve(VICTIM);
    expect(() => queue.reserve(VICTIM)).toThrow(ORIGIN_REFUSAL);
    again();
    for (const release of releases.slice(1)) {
      release();
    }
    expect(queue.list()).toEqual([]);
  });

  test("refuse concurrent work past the cap, and end once the request queues", async () => {
    const queue = createApprovalQueue();
    const gates: (() => void)[] = [];
    let started = 0;
    const work = () =>
      withApprovalReservation(queue, VICTIM, async () => {
        started += 1;
        await new Promise<void>((resolve) => gates.push(resolve));
        return invoke(queue, VICTIM, 1);
      });

    const running = Array.from({ length: MAX_PENDING_APPROVALS_PER_ORIGIN }, work);
    await Promise.resolve();
    // While all five are still working, nothing is queued, yet a sixth is
    // refused before it starts.
    expect(queue.list()).toEqual([]);
    expect(() => queue.reserve(VICTIM)).toThrow(ORIGIN_REFUSAL);
    expect(started).toBe(MAX_PENDING_APPROVALS_PER_ORIGIN);

    for (const open of gates) {
      open();
    }
    await Promise.all(running);
    expect(queue.list()).toHaveLength(MAX_PENDING_APPROVALS_PER_ORIGIN);
    expect(queue.canAdmit(VICTIM)).toMatch(ORIGIN_REFUSAL);
    queue.claim(queue.list()[0]?.id ?? "");
    expect(queue.canAdmit(VICTIM)).toBeNull();
  });

  test("hand over to the queued prompt with no moment counted twice", async () => {
    const queue = createApprovalQueue();
    for (let index = 0; index < MAX_PENDING_APPROVALS_PER_ORIGIN - 2; index += 1) {
      invoke(queue, VICTIM, 1);
    }
    let reservedAfterQueueing: (() => void) | null = null;
    await withApprovalReservation(queue, VICTIM, async (release) => {
      invoke(queue, VICTIM, 1);
      release();
      // The prompt just queued counts once, so the origin's last slot is free.
      reservedAfterQueueing = queue.reserve(VICTIM);
    });
    expect(reservedAfterQueueing).not.toBeNull();
  });

  test("are released when the work fails", async () => {
    const queue = createApprovalQueue();
    for (let index = 0; index < MAX_PENDING_APPROVALS_PER_ORIGIN; index += 1) {
      await expect(
        withApprovalReservation(queue, VICTIM, async () => {
          throw new Error("vault unavailable");
        }),
      ).rejects.toThrow("vault unavailable");
    }
    expect(queue.canAdmit(VICTIM)).toBeNull();
  });
});

describe("approvals the side panel cannot display (Sherlock 157)", () => {
  test("are refused at enqueue without displacing anyone", () => {
    const queue = createApprovalQueue();
    const reviewing = queue.request(VICTIM);

    expect(() => invoke(queue, NEWCOMER, 4_096)).toThrow(APPROVAL_TOO_LARGE);
    expect(queue.list()).toEqual([reviewing]);
  });

  test("every admitted invoke stays readable by the side panel", () => {
    const queue = createApprovalQueue();
    let felts = 1_024;
    while (felts < 4_096) {
      try {
        invoke(queue, `https://size-${felts}.example`, felts);
      } catch {
        break;
      }
      felts += 256;
    }
    expect(felts).toBeLessThan(4_096);
    const listed = queue.list();
    expect(listed.length).toBeGreaterThan(0);
    expect(readPendingApprovals({ ok: true, pending: listed })).toEqual(listed);
  });
});
