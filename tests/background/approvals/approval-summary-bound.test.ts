/**
 * An approval the panel cannot render is never queued (Sherlock 187).
 *
 * The panel drops an approval whose summary line is empty or longer than
 * `APPROVAL_SUMMARY_MAX_LENGTH`, so queuing one left the site's request waiting
 * with nothing on screen until it expired. The queue refuses it at admission
 * instead, and the background and panel bounds are the same constant.
 */
import { describe, expect, test } from "bun:test";
import { APPROVAL_SUMMARY_MAX_LENGTH } from "@bramble/wallet-protocol/extension-responses";
import { APPROVAL_SUMMARY_UNRENDERABLE } from "../../../apps/extension/src/background/approvals/approval-summary-bound";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { readPendingApprovals } from "../../../packages/presentation/wallet-ui/src/popup/responses/approvals-responses";

const ORIGIN = "https://dapp.example";
const CONTEXT = {
  accountId: "SN_MAIN:0x1",
  chainId: "0x534e5f4d41494e",
  networkId: "SN_MAIN" as const,
  payloadDigest: `sha256:${"a".repeat(64)}`,
};

const invokeWith = (summaries: readonly string[]) => {
  const queue = createApprovalQueue();
  const queueInvoke = () =>
    queue.requestInvoke({
      calls: [{ calldata: ["0x1"], contractAddress: "0x2", entrypoint: "transfer" }],
      context: CONTEXT,
      fee: {
        fee: null,
        feeAffordability: "unknown",
        feeEstimateFailed: false,
        feeEstimatePending: false,
        requiresDeployment: false,
      },
      flags: [],
      origin: ORIGIN,
      summaries,
    });
  return { queue, queueInvoke };
};

describe("approval summary bound", () => {
  test("queues a summary at the limit, and the panel renders it", () => {
    const { queue, queueInvoke } = invokeWith(["a".repeat(APPROVAL_SUMMARY_MAX_LENGTH)]);
    queueInvoke();
    const rendered = readPendingApprovals({ ok: true, pending: queue.list() });
    expect(rendered?.length).toBe(1);
  });

  test("refuses a summary past the limit before it reaches the queue", () => {
    const { queue, queueInvoke } = invokeWith([
      "Invoke",
      "a".repeat(APPROVAL_SUMMARY_MAX_LENGTH + 1),
    ]);
    expect(queueInvoke).toThrow(APPROVAL_SUMMARY_UNRENDERABLE);
    expect(queue.list()).toEqual([]);
  });

  test("refuses an empty summary line", () => {
    const { queue, queueInvoke } = invokeWith([""]);
    expect(queueInvoke).toThrow(APPROVAL_SUMMARY_UNRENDERABLE);
    expect(queue.list()).toEqual([]);
  });

  test("refuses a switch-chain summary past the limit", () => {
    const queue = createApprovalQueue();
    expect(() =>
      queue.requestSwitchChain({
        chainId: "0x534e5f4d41494e",
        networkId: "SN_MAIN",
        origin: ORIGIN,
        summary: "s".repeat(APPROVAL_SUMMARY_MAX_LENGTH + 1),
      }),
    ).toThrow(APPROVAL_SUMMARY_UNRENDERABLE);
  });

  test("the panel drops exactly what the queue refuses", () => {
    const over = { ...invokeWith(["Invoke"]) };
    over.queueInvoke();
    const [entry] = over.queue.list();
    const tooLong = { ...entry, summaries: ["a".repeat(APPROVAL_SUMMARY_MAX_LENGTH + 1)] };
    expect(readPendingApprovals({ ok: true, pending: [tooLong] })).toEqual([]);
  });
});
