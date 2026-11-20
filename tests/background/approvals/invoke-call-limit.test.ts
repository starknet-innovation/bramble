/**
 * A dapp invoke is capped at `INVOKE_LIMITS.calls`, the most minimal calls the
 * side-panel review budget admits. A batch the panel can review is parsed and
 * listed in full. A batch within the count whose worst-case card does not fit
 * is refused with "Request too large to review". Both parsers reject a list
 * past the count before the worker walks it.
 */
import { describe, expect, test } from "bun:test";
import { JSON_BUDGETS } from "@bramble/core/json";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { PendingApproval, WalletStatus } from "@bramble/wallet-protocol/extension-responses";
import { providerInvokeRequest } from "@bramble/wallet-protocol/invoke";
import { INVOKE_LIMITS } from "@bramble/wallet-protocol/invoke-limits";
import { readProviderParams } from "@bramble/wallet-protocol/request-params";
import { APPROVAL_TOO_LARGE } from "../../../apps/extension/src/background/approvals/approval-limits";
import {
  fitsSidePanel,
  referencesFitSidePanel,
} from "../../../apps/extension/src/background/approvals/approval-review-size";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { readAddInvokeTransactionInput } from "../../../apps/extension/src/background/routing/message-inputs";
import { readPendingApprovals } from "../../../packages/presentation/wallet-ui/src/popup/responses/approvals-responses";
import { approvalCard } from "../../../packages/presentation/wallet-ui/src/sidepanel/journeys/approvals/approval-cards";

const ORIGIN = "https://a.co";
const MINIMAL_CALL = { calldata: ["0x1"], contractAddress: "0x1", entrypoint: "a" } as const;

const calls = (count: number) =>
  Array.from({ length: count }, () => ({ ...MINIMAL_CALL, calldata: ["0x1"] }));

const approval = (count: number): PendingApproval => ({
  callReviews: calls(count),
  context: {
    accountId: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
    chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
    networkId: "SN_MAIN",
    payloadDigest: `sha256:${"a".repeat(64)}`,
  },
  fee: null,
  feeAffordability: "unknown",
  feeEstimateFailed: false,
  feeEstimatePending: true,
  flags: [],
  id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14",
  kind: "invoke",
  origin: ORIGIN,
  requiresDeployment: false,
  summaries: Array.from({ length: count }, (_, index) => `Minimal call ${index + 1}`),
});

const status: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const pageParams = (count: number) => ({
  calls: Array.from({ length: count }, () => ({
    calldata: ["0x1"],
    contract_address: "0x1",
    entry_point: "a",
  })),
});

const largestReviewable = (): number => {
  let low = 1;
  let high = 128;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fitsSidePanel(approval(mid))) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
};

describe("dapp invoke review budget", () => {
  const fitting = largestReviewable();
  const oversized = fitting + 1;

  test("the call cap is the largest minimal batch the review budget admits", () => {
    expect(fitting).toBe(INVOKE_LIMITS.calls);
    expect(fitsSidePanel(approval(fitting))).toBe(true);
    expect(fitsSidePanel(approval(oversized))).toBe(false);
  });

  test("both parsers accept the cap and refuse one more call", () => {
    const worker = (count: number) =>
      readAddInvokeTransactionInput({
        calls: calls(count),
        origin: ORIGIN,
        type: "wallet.addInvokeTransaction",
      });
    expect(providerInvokeRequest(pageParams(INVOKE_LIMITS.calls))?.calls).toHaveLength(
      INVOKE_LIMITS.calls,
    );
    expect(worker(INVOKE_LIMITS.calls)?.calls).toHaveLength(INVOKE_LIMITS.calls);
    expect(providerInvokeRequest(pageParams(INVOKE_LIMITS.calls + 1))).toBeNull();
    expect(worker(INVOKE_LIMITS.calls + 1)).toBeNull();
  });

  test("a realistic batch under the cap is refused by the review budget, not the count", () => {
    const full = (index: number) => `0x${index.toString(16).padStart(64, "0")}`;
    const transfers = (count: number): PendingApproval => ({
      ...approval(count),
      callReviews: Array.from({ length: count }, (_, index) => ({
        calldata: [full(7), "0xde0b6b3a7640000", "0x0"],
        contractAddress: full(1_000 + index),
        entrypoint: "transfer",
      })),
    });
    expect(fitsSidePanel(transfers(50))).toBe(true);
    expect(fitsSidePanel(transfers(INVOKE_LIMITS.calls))).toBe(false);
  });

  test("refuses an unreviewable batch at enqueue, not by counting calls", () => {
    const queue = createApprovalQueue();
    const context = approval(1).context;
    if (context === undefined) throw new Error("missing approval context");
    const input = {
      calls: calls(oversized),
      context,
      fee: {
        fee: null,
        feeAffordability: "unknown" as const,
        feeEstimateFailed: false,
        feeEstimatePending: true,
        requiresDeployment: false,
      },
      flags: [],
      origin: ORIGIN,
      summaries: approval(oversized).summaries ?? [],
    };
    expect(() => queue.requestInvoke(input)).toThrow(APPROVAL_TOO_LARGE);
    expect(queue.list()).toEqual([]);
    const admitted = queue.requestInvoke({
      ...input,
      calls: calls(fitting),
      summaries: approval(fitting).summaries ?? [],
    });
    expect(admitted.callReviews).toHaveLength(fitting);
    expect(readPendingApprovals({ ok: true, pending: [admitted] })).toEqual([admitted]);
  });

  test("a batch too large for its review references is queued in English, not refused", () => {
    expect(referencesFitSidePanel(approval(1))).toBe(true);
    expect(referencesFitSidePanel(approval(fitting))).toBe(false);
    const queue = createApprovalQueue();
    const context = approval(1).context;
    if (context === undefined) throw new Error("missing approval context");
    const summaries = approval(fitting).summaries ?? [];
    const admitted = queue.requestInvoke({
      calls: calls(fitting),
      context,
      fee: {
        fee: null,
        feeAffordability: "unknown" as const,
        feeEstimateFailed: false,
        feeEstimatePending: true,
        requiresDeployment: false,
      },
      flags: [],
      origin: ORIGIN,
      summaries,
      summaryTexts: summaries.map(() => ({ facts: {}, key: "review.switchNetwork" })),
    });
    expect(admitted.summaries).toEqual(summaries);
    expect(admitted.summaryTexts).toBeUndefined();
  });

  test("lists every call of a reviewable batch", () => {
    const html = approvalCard(approval(fitting), status);
    const exactCalls = html.match(/<strong>Call \d+<\/strong>/g) ?? [];
    const summaries = html.match(/<li class="review-call">/g) ?? [];
    expect(exactCalls).toHaveLength(fitting);
    expect(exactCalls[0]).toBe("<strong>Call 1</strong>");
    expect(exactCalls.at(-1)).toBe(`<strong>Call ${fitting}</strong>`);
    expect(summaries).toHaveLength(fitting);
    expect(html).toContain(`Minimal call ${fitting}`);
  });

  test("still rejects a calldata array past the generic message budget", () => {
    const tooLong = {
      calls: [
        {
          calldata: Array.from(
            { length: JSON_BUDGETS.strk20Proof.maxArrayLength + 1 },
            () => "0x1",
          ),
          contractAddress: "0x1",
          entrypoint: "a",
        },
      ],
      origin: ORIGIN,
      type: "wallet.addInvokeTransaction",
    };
    expect(readAddInvokeTransactionInput(tooLong)).toBeNull();
    expect(
      readProviderParams("wallet_addInvokeTransaction", {
        calls: [
          {
            calldata: Array.from(
              { length: JSON_BUDGETS.strk20Proof.maxArrayLength + 1 },
              () => "0x1",
            ),
            contract_address: "0x1",
            entry_point: "a",
          },
        ],
      }),
    ).toBeNull();
  });
});
