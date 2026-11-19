/**
 * The dapp invoke call count is the largest minimal batch the side panel can
 * still review. A minimal call is one calldata felt, a one-character
 * entrypoint, and a single-digit address: the worst-case card (one summary and
 * seven flag slots per call) fits `INVOKE_LIMITS.calls` of them and refuses one
 * more. Parsers accept that count and reject the next, and the approval card
 * lists every call.
 */
import { describe, expect, test } from "bun:test";
import { isJsonWithinBudget, JSON_BUDGETS } from "@bramble/core/json";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { PendingApproval, WalletStatus } from "@bramble/wallet-protocol/extension-responses";
import { providerInvokeRequest } from "@bramble/wallet-protocol/invoke";
import { INVOKE_LIMITS } from "@bramble/wallet-protocol/invoke-limits";
import { readProviderParams } from "@bramble/wallet-protocol/request-params";
import { transaction } from "starknet";
import { fitsSidePanel } from "../../../apps/extension/src/background/approvals/approval-review-size";
import { readAddInvokeTransactionInput } from "../../../apps/extension/src/background/routing/message-inputs";
import { readPendingApprovals } from "../../../packages/presentation/wallet-ui/src/popup/responses/approvals-responses";
import { approvalCard } from "../../../packages/presentation/wallet-ui/src/sidepanel/journeys/approvals/approval-cards";

// Starknet 0.14.4 gateway limit (docs.starknet.io chain-info, max calldata length).
const SEQUENCER_CALLDATA_FELTS = 5_000;

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

describe("dapp invoke call count", () => {
  test("accepts a minimal batch at the limit and rejects one more call", () => {
    const accepted = providerInvokeRequest(pageParams(INVOKE_LIMITS.calls));
    const rejected = providerInvokeRequest(pageParams(INVOKE_LIMITS.calls + 1));
    expect(accepted?.calls).toHaveLength(INVOKE_LIMITS.calls);
    expect(rejected).toBeNull();

    expect(
      readAddInvokeTransactionInput({
        calls: calls(INVOKE_LIMITS.calls),
        origin: ORIGIN,
        type: "wallet.addInvokeTransaction",
      })?.calls,
    ).toHaveLength(INVOKE_LIMITS.calls);
    expect(
      readAddInvokeTransactionInput({
        calls: calls(INVOKE_LIMITS.calls + 1),
        origin: ORIGIN,
        type: "wallet.addInvokeTransaction",
      }),
    ).toBeNull();
  });

  test("fits the review budget at the limit and not one call past it", () => {
    expect(fitsSidePanel(approval(INVOKE_LIMITS.calls))).toBe(true);
    expect(fitsSidePanel(approval(INVOKE_LIMITS.calls + 1))).toBe(false);
    expect(
      fitsSidePanel({
        ...approval(INVOKE_LIMITS.calls),
        fee: { overallFee: "2500000000000000", unit: "FRI" },
        feeAffordability: "ok",
        feeEstimatePending: false,
      }),
    ).toBe(true);
  });

  test("keeps every call on the approval card and inside the message budgets", () => {
    const atLimit = approval(INVOKE_LIMITS.calls);
    expect(readPendingApprovals({ ok: true, pending: [atLimit] })).toEqual([atLimit]);

    const html = approvalCard(atLimit, status);
    const exactCalls = html.match(/<strong>Call \d+<\/strong>/g) ?? [];
    const summaries = html.match(/<li class="review-call">/g) ?? [];
    expect(exactCalls).toHaveLength(INVOKE_LIMITS.calls);
    expect(exactCalls[0]).toBe("<strong>Call 1</strong>");
    expect(exactCalls.at(-1)).toBe(`<strong>Call ${INVOKE_LIMITS.calls}</strong>`);
    expect(summaries).toHaveLength(INVOKE_LIMITS.calls);
    expect(html).toContain(`Minimal call ${INVOKE_LIMITS.calls}`);

    const normalized = readProviderParams(
      "wallet_addInvokeTransaction",
      pageParams(INVOKE_LIMITS.calls),
    );
    expect(normalized).not.toBeNull();
    expect(
      isJsonWithinBudget(
        {
          calls: calls(INVOKE_LIMITS.calls),
          origin: ORIGIN,
          type: "wallet.addInvokeTransaction",
        },
        JSON_BUDGETS.provider,
      ),
    ).toBe(true);

    // Cairo 1 execute calldata: length, then to, selector, calldata length, and
    // the one argument. Starknet rejects a transaction past 5,000 felts.
    const compiled = transaction.getExecuteCalldata(calls(INVOKE_LIMITS.calls), "1");
    expect(compiled).toHaveLength(1 + 4 * INVOKE_LIMITS.calls);
    expect(compiled.length).toBeLessThanOrEqual(SEQUENCER_CALLDATA_FELTS);
  });
});
