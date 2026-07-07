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

    expect(queue.list()).toEqual([
      { id: approval.id, kind: "connect", origin: "https://example.com" },
    ]);
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

  test("queues watch-asset prompts per origin and token", () => {
    const queue = createApprovalQueue();
    const token = {
      address: "0x1",
      decimals: 18,
      name: "Test Token",
      networkId: "SN_MAIN" as const,
      symbol: "TST",
    };
    const other = { ...token, address: "0x2", symbol: "OTH" };

    const first = queue.requestWatchAsset({ origin: "https://example.com", token });
    const repeat = queue.requestWatchAsset({ origin: "https://example.com", token });
    const second = queue.requestWatchAsset({ origin: "https://example.com", token: other });

    expect(first.kind).toBe("watch-asset");
    expect(first.token).toEqual(token);
    expect(repeat).toEqual(first);
    expect(second.id).not.toBe(first.id);
    expect(queue.list()).toHaveLength(2);
  });

  test("keeps watch-asset snapshots isolated from queue state", () => {
    const queue = createApprovalQueue();
    const approval = queue.requestWatchAsset({
      origin: "https://example.com",
      token: {
        address: "0x1",
        decimals: 18,
        name: "Test Token",
        networkId: "SN_MAIN",
        symbol: "TST",
      },
    });
    (approval.token as { symbol: string }).symbol = "HACK";

    expect(queue.get(approval.id)?.token?.symbol).toBe("TST");
  });

  test("rejects watch-asset requests from invalid origins", () => {
    const queue = createApprovalQueue();

    expect(() =>
      queue.requestWatchAsset({
        origin: "http://example.com",
        token: {
          address: "0x1",
          decimals: 18,
          name: "Test Token",
          networkId: "SN_MAIN",
          symbol: "TST",
        },
      }),
    ).toThrow("Invalid origin");
  });
});
