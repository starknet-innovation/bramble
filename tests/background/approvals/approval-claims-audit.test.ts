/**
 * Decisions on a request the queue no longer holds, Sherlock 217 and 220.
 *
 * - 217: a refusal after a claim, or an executor's error answer, announces the
 *   queue change, so the toolbar badge stops counting a request that is gone.
 * - 220: denying a request another surface already decided reports that,
 *   instead of "Request denied".
 */
import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_ORIGIN_GUARD } from "@bramble/permissions/blocklist";
import { memoryOriginHistory } from "@bramble/permissions/origin-history";
import { memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import {
  type ApprovalDecisionDeps,
  handleApprovalDecision,
} from "../../../apps/extension/src/background/approvals/approval-decisions";
import { setApprovalNotifier } from "../../../apps/extension/src/background/approvals/approval-notifier";
import {
  type ApprovalQueue,
  createApprovalQueue,
} from "../../../apps/extension/src/background/approvals/approvals";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";

const VICTIM = "https://victim.example";

afterEach(() => setApprovalNotifier(() => undefined));

const recordingWaiters = () => {
  const settled: { id: string; response: unknown }[] = [];
  return {
    settled,
    waiters: {
      pending: () => 0,
      register: async () => ({ error: "unused" }),
      settle: (id: string, response: unknown) => {
        settled.push({ id, response });
      },
    },
  };
};

const decisionDeps = (
  approvals: ApprovalQueue,
  overrides: Readonly<Record<string, unknown>> = {},
): ApprovalDecisionDeps =>
  ({
    allowanceStore: memoryAllowanceStore(),
    approvals,
    guard: DEFAULT_ORIGIN_GUARD,
    originHistory: memoryOriginHistory(),
    session: createUnlockSession(),
    waiters: recordingWaiters().waiters,
    ...overrides,
  }) as unknown as ApprovalDecisionDeps;

describe("a refusal after the claim (Sherlock 217)", () => {
  test("announces the queue change", async () => {
    const queue = createApprovalQueue();
    const approval = queue.request(VICTIM);
    let notified = 0;
    setApprovalNotifier(() => {
      notified += 1;
    });
    const { settled, waiters } = recordingWaiters();
    const deps = decisionDeps(queue, {
      guard: { ...DEFAULT_ORIGIN_GUARD, isBlocked: () => true },
      waiters,
    });

    await expect(
      handleApprovalDecision(deps, "wallet.approveOrigin", {
        id: approval.id,
        type: "wallet.approveOrigin",
      }),
    ).resolves.toEqual({ error: "origin blocked" });

    expect(queue.list()).toEqual([]);
    expect(settled).toEqual([{ id: approval.id, response: { error: "origin blocked" } }]);
    expect(notified).toBe(1);
  });

  test("announces the queue change when the executor answers with an error", async () => {
    const queue = createApprovalQueue();
    const approval = queue.requestSwitchChain({
      chainId: "0x534e5f5345504f4c4941",
      networkId: "SN_SEPOLIA",
      origin: VICTIM,
      summary: "Switch network",
    });
    let notified = 0;
    setApprovalNotifier(() => {
      notified += 1;
    });
    const session = createUnlockSession();
    session.unlock("correct horse battery staple");
    const { settled, waiters } = recordingWaiters();
    const deps = decisionDeps(queue, {
      session,
      waiters,
      wallet: { getGrantedAccounts: async () => [] },
    });

    await expect(
      handleApprovalDecision(deps, "wallet.approveOrigin", {
        id: approval.id,
        type: "wallet.approveOrigin",
      }),
    ).resolves.toEqual({ error: "origin not connected" });

    expect(queue.list()).toEqual([]);
    expect(settled).toEqual([{ id: approval.id, response: { error: "origin not connected" } }]);
    expect(notified).toBe(1);
  });

  test("is not announced when nothing was claimed", async () => {
    let notified = 0;
    setApprovalNotifier(() => {
      notified += 1;
    });
    await expect(
      handleApprovalDecision(decisionDeps(createApprovalQueue()), "wallet.approveOrigin", {
        id: crypto.randomUUID(),
        type: "wallet.approveOrigin",
      }),
    ).resolves.toEqual({ error: "approval not found" });
    expect(notified).toBe(0);
  });
});

describe("denying a request that is no longer pending (Sherlock 220)", () => {
  test("reports that instead of a denial, and settles nothing", async () => {
    const queue = createApprovalQueue();
    const approval = queue.request(VICTIM);
    // Another surface approved it first.
    expect(queue.claim(approval.id)).not.toBeNull();
    const { settled, waiters } = recordingWaiters();

    await expect(
      handleApprovalDecision(decisionDeps(queue, { waiters }), "wallet.denyOrigin", {
        id: approval.id,
        type: "wallet.denyOrigin",
      }),
    ).resolves.toEqual({ error: "approval no longer pending" });
    expect(settled).toEqual([]);
  });

  test("still denies a pending request", async () => {
    const queue = createApprovalQueue();
    const approval = queue.request(VICTIM);
    const { settled, waiters } = recordingWaiters();

    await expect(
      handleApprovalDecision(decisionDeps(queue, { waiters }), "wallet.denyOrigin", {
        id: approval.id,
        type: "wallet.denyOrigin",
      }),
    ).resolves.toEqual({ ok: true, pending: [] });
    expect(settled).toEqual([{ id: approval.id, response: { error: "connection rejected" } }]);
  });
});
