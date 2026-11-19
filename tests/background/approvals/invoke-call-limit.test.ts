/**
 * A dapp invoke has no call-count limit. A batch the side panel can review is
 * parsed and listed in full. A batch whose worst-case card does not fit the
 * review budget is refused with "Request too large to review", not by a count.
 * The generic JSON message budget still rejects an array past its own cap.
 */
import { describe, expect, test } from "bun:test";
import { JSON_BUDGETS } from "@bramble/core/json";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { PendingApproval, WalletStatus } from "@bramble/wallet-protocol/extension-responses";
import { providerInvokeRequest } from "@bramble/wallet-protocol/invoke";
import { readProviderParams } from "@bramble/wallet-protocol/request-params";
import { APPROVAL_TOO_LARGE } from "../../../apps/extension/src/background/approvals/approval-limits";
import { fitsSidePanel } from "../../../apps/extension/src/background/approvals/approval-review-size";
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

  test("parses a batch the review budget accepts and one it refuses", () => {
    expect(fitting).toBeGreaterThan(1);
    expect(fitsSidePanel(approval(fitting))).toBe(true);
    expect(fitsSidePanel(approval(oversized))).toBe(false);

    expect(providerInvokeRequest(pageParams(oversized))?.calls).toHaveLength(oversized);
    expect(
      readAddInvokeTransactionInput({
        calls: calls(oversized),
        origin: ORIGIN,
        type: "wallet.addInvokeTransaction",
      })?.calls,
    ).toHaveLength(oversized);
    expect(readProviderParams("wallet_addInvokeTransaction", pageParams(oversized))).not.toBeNull();
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
