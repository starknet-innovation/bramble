/**
 * Regression checks for MCW-V09-116: the approval queue enforced only a global
 * cap with no per-origin bound and no TTL, so one unconnected origin could fill
 * all 50 slots — watch-asset needs no grant and dedupes only per token address —
 * and deny the wallet's entire consent surface to every other site until the
 * user manually cleared it.
 *
 * The per-origin cases assert the exact refusal each origin gets while another
 * origin is still admitted, and free slots through `claim` — the call the
 * approval decisions actually make — so none of them can pass against a queue
 * that has only the global cap. The TTL cases additionally pin that a sweep
 * reports what it dropped: expiry frees an admission slot, so anything keyed by
 * an approval id (above all the parked dapp response) has to be released with
 * it. See tests/background/approval-expiry-waiter-release.test.ts.
 */
import { describe, expect, test } from "bun:test";
import {
  APPROVAL_TTL_MS,
  createApprovalQueue,
  MAX_PENDING_APPROVALS,
  MAX_PENDING_APPROVALS_PER_ORIGIN,
} from "../../apps/extension/src/background/approvals/approvals";

const ATTACKER = "https://attacker.example";
const HONEST = "https://honest.example";

// Exact refusal messages. `toThrow("Too many pending approvals")` also matches
// the per-origin message by substring, which would let a global-cap assertion
// pass while the per-origin cap did the refusing — anchor both.
const GLOBAL_REFUSAL = /^Too many pending approvals$/;
const ORIGIN_REFUSAL = /^Too many pending approvals for this site$/;

const token = (index: number) => ({
  address: `0x${(index + 1).toString(16)}`,
  decimals: 18,
  name: `Token ${index}`,
  networkId: "SN_MAIN" as const,
  symbol: `TK${index}`,
});

// Queues `count` distinct watch-asset prompts for one origin. Distinct token
// addresses defeat the watch-asset dedupe, which is the flooding vector.
const flood = (
  queue: ReturnType<typeof createApprovalQueue>,
  origin: string,
  count: number,
  offset = 0,
): void => {
  for (let index = 0; index < count; index += 1) {
    queue.requestWatchAsset({ origin, token: token(offset + index) });
  }
};

describe("approval queue per-origin cap (MCW-V09-116)", () => {
  test("refuses a flooding origin once it holds its share of the queue", () => {
    const queue = createApprovalQueue();
    flood(queue, ATTACKER, MAX_PENDING_APPROVALS_PER_ORIGIN);

    expect(() =>
      queue.requestWatchAsset({ origin: ATTACKER, token: token(MAX_PENDING_APPROVALS_PER_ORIGIN) }),
    ).toThrow(ORIGIN_REFUSAL);
    expect(queue.list()).toHaveLength(MAX_PENDING_APPROVALS_PER_ORIGIN);
  });

  test("keeps consent available to another origin past the point the cap binds", () => {
    const queue = createApprovalQueue();
    flood(queue, ATTACKER, MAX_PENDING_APPROVALS_PER_ORIGIN);

    // The refusal must be scoped to the flooder: every further attempt from it
    // is refused for this site, while an honest origin fills its own share.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(() => queue.request(ATTACKER)).toThrow(ORIGIN_REFUSAL);
    }
    for (let index = 0; index < MAX_PENDING_APPROVALS_PER_ORIGIN; index += 1) {
      const honest = queue.requestWatchAsset({ origin: HONEST, token: token(100 + index) });
      expect(honest.origin).toBe(HONEST);
      expect(queue.get(honest.id)).toEqual(honest);
    }
    expect(queue.list()).toHaveLength(MAX_PENDING_APPROVALS_PER_ORIGIN * 2);
  });

  test("does not spend a slot on a deduplicated re-request", () => {
    const queue = createApprovalQueue();
    const first = queue.requestWatchAsset({ origin: ATTACKER, token: token(0) });
    flood(queue, ATTACKER, MAX_PENDING_APPROVALS_PER_ORIGIN - 2, 1);

    // The same token from the same origin is the existing prompt, not a new one,
    // so repeating it must neither grow the queue nor consume the last slot.
    for (let repeat = 0; repeat < 10; repeat += 1) {
      expect(queue.requestWatchAsset({ origin: ATTACKER, token: token(0) })).toEqual(first);
    }
    expect(queue.list()).toHaveLength(MAX_PENDING_APPROVALS_PER_ORIGIN - 1);
    expect(() => queue.requestWatchAsset({ origin: ATTACKER, token: token(50) })).not.toThrow();
    expect(() => queue.requestWatchAsset({ origin: ATTACKER, token: token(51) })).toThrow(
      ORIGIN_REFUSAL,
    );
  });

  test("replaces an overrepresented prompt so a new origin cannot be starved", () => {
    const queue = createApprovalQueue();
    // One origin can no longer reach the global cap by itself: it is stopped by
    // its own share first, and with the exact per-origin message.
    expect(() => flood(queue, ATTACKER, MAX_PENDING_APPROVALS)).toThrow(ORIGIN_REFUSAL);
    expect(queue.list()).toHaveLength(MAX_PENDING_APPROVALS_PER_ORIGIN);

    const origins = Math.floor(MAX_PENDING_APPROVALS / MAX_PENDING_APPROVALS_PER_ORIGIN);
    for (let site = 1; site < origins; site += 1) {
      flood(
        queue,
        `https://site-${site}.example`,
        MAX_PENDING_APPROVALS_PER_ORIGIN,
        site * MAX_PENDING_APPROVALS_PER_ORIGIN,
      );
    }

    expect(queue.list()).toHaveLength(origins * MAX_PENDING_APPROVALS_PER_ORIGIN);
    const oldest = queue.list()[0];
    const late = queue.request("https://late.example");

    expect(queue.list()).toHaveLength(MAX_PENDING_APPROVALS);
    expect(queue.get(oldest?.id ?? "")).toBeNull();
    expect(queue.get(late.id)).toEqual(late);
    // Once represented, that origin cannot use replacement to grow its share.
    expect(() =>
      queue.requestWatchAsset({ origin: late.origin, token: token(MAX_PENDING_APPROVALS + 1) }),
    ).toThrow(GLOBAL_REFUSAL);
  });

  test("frees the origin's slots as its prompts are claimed", () => {
    const queue = createApprovalQueue();
    flood(queue, ATTACKER, MAX_PENDING_APPROVALS_PER_ORIGIN);
    const [answered] = queue.list();
    expect(answered).toBeDefined();
    expect(() => queue.request(ATTACKER)).toThrow(ORIGIN_REFUSAL);

    // `claim` is the path the product takes for both approve and deny (see
    // background/approvals/approval-decisions.ts); assert against that, not `deny`.
    expect(queue.claim(answered?.id ?? "")?.approval).toEqual(answered);
    expect(() =>
      queue.requestWatchAsset({ origin: ATTACKER, token: token(MAX_PENDING_APPROVALS_PER_ORIGIN) }),
    ).not.toThrow();
    // Exactly one slot came back, not the whole share.
    expect(() => queue.request(ATTACKER)).toThrow(ORIGIN_REFUSAL);
  });
});

describe("approval queue TTL sweep (MCW-V09-116)", () => {
  test("keeps an approval that has not yet reached the TTL", () => {
    let now = 1_700_000_000_000;
    const queue = createApprovalQueue({ now: () => now });
    const approval = queue.request("https://honest.example");

    now += APPROVAL_TTL_MS - 1;
    expect(queue.list()).toEqual([approval]);
    expect(queue.get(approval.id)).toEqual(approval);
  });

  test("treats an abandoned approval as absent everywhere", () => {
    let now = 1_700_000_000_000;
    const queue = createApprovalQueue({ now: () => now });
    const approval = queue.request("https://honest.example");

    now += APPROVAL_TTL_MS;
    expect(queue.list()).toEqual([]);
    expect(queue.get(approval.id)).toBeNull();
    expect(queue.payload(approval.id)).toBeNull();
    expect(queue.claim(approval.id)).toBeNull();
  });

  test("drains an abandoned flood so the queue admits new prompts again", () => {
    let now = 1_700_000_000_000;
    const queue = createApprovalQueue({ now: () => now });
    flood(queue, ATTACKER, MAX_PENDING_APPROVALS_PER_ORIGIN);
    expect(() =>
      queue.requestWatchAsset({ origin: ATTACKER, token: token(MAX_PENDING_APPROVALS_PER_ORIGIN) }),
    ).toThrow("Too many pending approvals for this site");

    now += APPROVAL_TTL_MS;
    flood(queue, ATTACKER, MAX_PENDING_APPROVALS_PER_ORIGIN);
    expect(queue.list()).toHaveLength(MAX_PENDING_APPROVALS_PER_ORIGIN);
  });

  test("never matches an expired approval as a deduplication hit", () => {
    let now = 1_700_000_000_000;
    const queue = createApprovalQueue({ now: () => now });
    const first = queue.request("https://honest.example");

    now += APPROVAL_TTL_MS;
    const second = queue.request("https://honest.example");
    expect(second.id).not.toBe(first.id);
    expect(queue.list()).toEqual([second]);
  });

  test("ages each approval from its own arrival, not the queue's", () => {
    let now = 1_700_000_000_000;
    const queue = createApprovalQueue({ now: () => now });
    const early = queue.request("https://early.example");

    now += APPROVAL_TTL_MS - 1;
    const late = queue.request("https://late.example");
    now += 1;

    expect(queue.get(early.id)).toBeNull();
    expect(queue.list()).toEqual([late]);
  });

  test("reports the swept ids so whatever is keyed by them is released too", () => {
    let now = 1_700_000_000_000;
    const queue = createApprovalQueue({ now: () => now });
    const seenDuringSweep: (unknown | null)[] = [];
    const reported: string[][] = [];
    queue.observeDrops((ids) => {
      reported.push([...ids]);
      // The entries are already gone when the observer runs, so a release path
      // that re-reads the queue can never resurrect an expired approval.
      seenDuringSweep.push(...ids.map((id) => queue.get(id)));
    });
    const first = queue.request(HONEST);
    const second = queue.requestWatchAsset({ origin: ATTACKER, token: token(0) });

    now += APPROVAL_TTL_MS;
    expect(queue.list()).toEqual([]);
    expect(reported).toEqual([[first.id, second.id]]);
    expect(seenDuringSweep).toEqual([null, null]);

    // A sweep that drops nothing must not report, or every read would look like
    // an expiry to the panel and the waiter registry.
    expect(queue.list()).toEqual([]);
    expect(reported).toHaveLength(1);
  });

  test("keeps prompts when the clock jumps backwards, and expires them later", () => {
    let now = 1_700_000_000_000;
    const queue = createApprovalQueue({ now: () => now });
    const reported: string[][] = [];
    queue.observeDrops((ids) => reported.push([...ids]));
    const approval = queue.request(HONEST);

    // A rewound clock preserves the prompt rather than dropping one the user may
    // be mid-review of. That is deliberate, and it is fail-open for flooding:
    // the flooder keeps its slots until the clock catches up — but the caps
    // still refuse anything new meanwhile.
    now -= APPROVAL_TTL_MS * 10;
    expect(queue.list()).toEqual([approval]);
    expect(reported).toEqual([]);
    flood(queue, HONEST, MAX_PENDING_APPROVALS_PER_ORIGIN - 1);
    expect(() => queue.request(ATTACKER)).not.toThrow();
    expect(() => queue.requestWatchAsset({ origin: HONEST, token: token(99) })).toThrow(
      ORIGIN_REFUSAL,
    );

    now += APPROVAL_TTL_MS * 11;
    expect(queue.list()).toEqual([]);
    expect(reported.flat()).toContain(approval.id);
  });
});
