/**
 * Consent-queue resilience at the popup boundary (MCW-V09-106). The pending
 * approval list used to be validated as a whole: one malformed entry — or a
 * queue of individually legal typed-data prompts that summed past a single
 * shared JSON budget — rejected the entire response, so every prompt the user
 * still had to approve or reject disappeared. These tests pin the two halves of
 * the fix: each entry carries its own hostile-input budget, and
 * `readPendingApprovals` drops only the offending entry.
 */
import { describe, expect, test } from "bun:test";
import { isJson, isJsonWithinBudget, JSON_BUDGETS, type Json } from "@bramble/core/json";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import {
  isPendingApprovalsResponse,
  type PendingApproval,
  readPendingApprovals,
} from "../../../src/popup/responses/approvals-responses";
import { isApprovalDecisionResponse } from "../../../src/popup/responses/responses";

const ORIGIN = "https://dapp.example";

const ids = [
  "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff10",
  "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff11",
  "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff12",
  "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff13",
  "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14",
] as const;

const context = {
  accountId: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
  networkId: "SN_MAIN" as const,
  payloadDigest: `sha256:${"a".repeat(64)}`,
};

// A SNIP-12 payload a dapp may legitimately ask to sign: it fits the tighter
// typed-data budget the background enforces when the request arrives.
const heavyTypedData = (): Json => ({
  domain: { name: "Heavy", version: "1" },
  message: { note: "a".repeat(43_000) },
  primaryType: "Mail",
  types: { StarknetDomain: [{ name: "name", type: "shortstring" }] },
});

const typedDataApproval = (id: string): PendingApproval => ({
  context,
  id,
  kind: "sign-typed-data",
  origin: ORIGIN,
  typedData: heavyTypedData(),
});

const invokeApproval = (id: string): PendingApproval => ({
  context,
  fee: { overallFee: "2500000000000000", unit: "FRI" },
  id,
  kind: "invoke",
  origin: ORIGIN,
  summaries: ["Send 1000 units to 0x0005…0005"],
});

const queue = (...pending: readonly unknown[]): unknown => ({ ok: true, pending });

describe("pending approval queue budgeting (MCW-V09-106)", () => {
  test("each queued typed-data prompt is individually within the request budget", () => {
    expect(isJsonWithinBudget(heavyTypedData(), JSON_BUDGETS.typedData)).toBe(true);
  });

  test("a queue of individually legal prompts breaches a single aggregate budget", () => {
    // The pre-fix guard applied one message budget to the whole response, so
    // this is exactly the shape that used to blank the queue.
    expect(isJson(queue(...ids.map(typedDataApproval)))).toBe(false);
  });

  test("keeps every prompt in a queue that only breaches the aggregate budget", () => {
    const response = queue(...ids.map(typedDataApproval));
    expect(readPendingApprovals(response)).toHaveLength(ids.length);
    expect(isPendingApprovalsResponse(response)).toBe(true);
  });

  test("still rejects a single approval whose own payload exceeds the budget", () => {
    const oversized = {
      ...typedDataApproval(ids[0]),
      typedData: { message: { note: "a".repeat(200_000) }, primaryType: "Mail" },
    };
    expect(readPendingApprovals(queue(oversized))).toEqual([]);
  });
});

describe("pending approval queue per-entry validation (MCW-V09-106)", () => {
  test("drops an unknown approval kind and keeps the rest reviewable", () => {
    const good = invokeApproval(ids[0]);
    const unknownKind = { id: ids[1], kind: "future-prompt", origin: ORIGIN };
    expect(readPendingApprovals(queue(good, unknownKind))).toEqual([good]);
    expect(readPendingApprovals(queue(unknownKind, good))).toEqual([good]);
  });

  test("drops an approval whose fee unit is neither FRI nor WEI", () => {
    const good = invokeApproval(ids[0]);
    const badUnit = { ...invokeApproval(ids[1]), fee: { overallFee: "1", unit: "GWEI" } };
    expect(readPendingApprovals(queue(good, badUnit))).toEqual([good]);
  });

  test("drops a duplicate id and a duplicate connection origin, keeping the first", () => {
    const first = invokeApproval(ids[0]);
    const duplicateId = { ...invokeApproval(ids[0]), summaries: ["Send 1 unit"] };
    expect(readPendingApprovals(queue(first, duplicateId))).toEqual([first]);

    const connect = { id: ids[1], kind: "connect" as const, origin: ORIGIN };
    const sameOrigin = { id: ids[2], kind: "connect", origin: ORIGIN };
    expect(readPendingApprovals(queue(connect, sameOrigin))).toEqual([connect]);
  });

  test("drops a missing array slot instead of the whole queue", () => {
    const sparse = new Array<unknown>(2);
    sparse[1] = invokeApproval(ids[0]);
    // Built without spreading, so slot 0 stays a genuine hole.
    const response = { ok: true, pending: sparse };
    expect(readPendingApprovals(response)).toEqual([invokeApproval(ids[0])]);
    expect(isPendingApprovalsResponse(response)).toBe(false);
  });

  test("rejects the envelope itself rather than salvaging entries", () => {
    expect(readPendingApprovals({ ok: false, pending: [] })).toBeNull();
    expect(readPendingApprovals({ ok: true, pending: {} })).toBeNull();
    expect(readPendingApprovals({ debug: true, ok: true, pending: [] })).toBeNull();
    expect(readPendingApprovals(null)).toBeNull();
    expect(readPendingApprovals({ ok: true, pending: [] })).toEqual([]);
  });

  test("the all-or-nothing guard stays strict about malformed entries", () => {
    const good = invokeApproval(ids[0]);
    expect(isPendingApprovalsResponse(queue(good))).toBe(true);
    expect(
      isPendingApprovalsResponse(queue(good, { id: ids[1], kind: "future", origin: ORIGIN })),
    ).toBe(false);
  });

  test("an approve/deny ack survives a malformed prompt still queued behind it", () => {
    // The decision already applied background-side; a sibling prompt the popup
    // cannot render must not be reported to the user as "approval failed".
    const good = invokeApproval(ids[0]);
    const malformed = { id: ids[1], kind: "future-prompt", origin: ORIGIN };
    expect(isApprovalDecisionResponse(queue(good, malformed))).toBe(true);
    expect(isApprovalDecisionResponse({ ok: true })).toBe(false);
    expect(isApprovalDecisionResponse({ error: "denied" })).toBe(false);
  });
});

// The whole-envelope `isJson` gate used to bound the queue itself. Per-entry
// budgeting removed it, so these pin the replacement bounds directly.
describe("pending approval queue envelope bounds (MCW-V09-106)", () => {
  const uuid = (index: number): string =>
    `b81c5dd1-53ff-4b7b-a171-${index.toString(16).padStart(12, "0")}`;

  test("rejects a queue longer than the shared provider array bound", () => {
    const cap = JSON_BUDGETS.provider.maxArrayLength;
    const atCap = Array.from({ length: cap }, (_, index) => invokeApproval(uuid(index)));
    expect(readPendingApprovals(queue(...atCap))).toHaveLength(cap);
    const overCap = [...atCap, invokeApproval(uuid(cap))];
    expect(readPendingApprovals(queue(...overCap))).toBeNull();
    expect(isPendingApprovalsResponse(queue(...overCap))).toBe(false);
  });

  test("rejects a pending array carrying own non-index properties", () => {
    const pending: unknown[] = [invokeApproval(ids[0])];
    Object.defineProperty(pending, "smuggled", { enumerable: true, value: { id: ids[1] } });
    expect(readPendingApprovals({ ok: true, pending })).toBeNull();
    expect(isPendingApprovalsResponse({ ok: true, pending })).toBe(false);
  });
});

describe("add-chain prompt summaries (MCW-V09-106)", () => {
  // `addChainSummaries` emits the RPC host verbatim and the dapp controls it:
  // `isHttpUrl` bounds the URL at 2048 characters with no bound on the host, so
  // the popup's 300-character summary cap can reject the add-chain entry. That
  // entry is dropped, but the honest prompt queued beside it stays reviewable.
  test("an over-long add-chain host drops only its own prompt", () => {
    const honest = { id: ids[0], kind: "connect" as const, origin: "https://honest.example" };
    const longHost = {
      id: ids[1],
      kind: "add-chain",
      origin: ORIGIN,
      summaries: ["Evil Chain", "0x534e5f5345504f4c4941", `${"a".repeat(400)}.example.com`],
    };
    expect(readPendingApprovals(queue(longHost, honest))).toEqual([honest]);
    expect(isPendingApprovalsResponse(queue(longHost, honest))).toBe(false);
  });

  test("an add-chain prompt with a summary inside the cap is kept", () => {
    const addChain: PendingApproval = {
      id: ids[1],
      kind: "add-chain",
      origin: ORIGIN,
      summaries: ["Evil Chain", "0x534e5f5345504f4c4941", "rpc.example.com"],
    };
    expect(readPendingApprovals(queue(addChain))).toEqual([addChain]);
  });
});
