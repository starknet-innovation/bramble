/**
 * Approval queue checks prove dapp connection prompts are explicit and removable.
 */
import { describe, expect, test } from "bun:test";
import { createApprovalQueue, MAX_PENDING_APPROVALS } from "../src/background/approvals";

describe("createApprovalQueue", () => {
  test("deduplicates requests by origin", () => {
    const queue = createApprovalQueue();
    const first = queue.request("https://example.com");
    const second = queue.request("https://example.com");

    expect(second).toEqual(first);
    expect(queue.list()).toEqual([first]);
  });

  test("rejects invalid origins", () => {
    const queue = createApprovalQueue();

    expect(() => queue.request("http://example.com")).toThrow("Invalid origin");
    expect(queue.list()).toEqual([]);
  });

  test("removes approved and denied requests", () => {
    const queue = createApprovalQueue();
    const approved = queue.request("https://approve.example");
    const denied = queue.request("https://deny.example");

    expect(queue.approve("not-a-uuid")).toBeNull();
    expect(queue.approve(approved.id)).toEqual(approved);
    expect(queue.deny(denied.id)).toEqual(denied);
    expect(queue.list()).toEqual([]);
  });

  test("returns snapshots instead of mutable queue state", () => {
    const queue = createApprovalQueue();
    const approval = queue.request("https://example.com");
    const returned = approval as { origin: string };
    const listed = queue.list()[0] as { origin: string };
    const peeked = queue.get(approval.id) as { origin: string };

    returned.origin = "https://changed.example";
    listed.origin = "https://listed.example";
    peeked.origin = "https://peeked.example";

    expect(queue.list()).toEqual([{ id: approval.id, origin: "https://example.com" }]);
  });

  test("caps pending approvals without breaking origin deduplication", () => {
    const queue = createApprovalQueue();
    const first = queue.request("https://app-0.example");

    for (let index = 1; index < MAX_PENDING_APPROVALS; index += 1) {
      queue.request(`https://app-${index}.example`);
    }

    expect(queue.request("https://app-0.example")).toEqual(first);
    expect(() => queue.request("https://overflow.example")).toThrow("Too many pending approvals");
    expect(queue.list()).toHaveLength(MAX_PENDING_APPROVALS);
  });
});
