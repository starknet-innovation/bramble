/**
 * Decode/risk-layer parity between the in-wallet Send review and the dApp
 * approval invoke card (issue #19). Both surfaces run the same shared verify
 * layer (`verifyCalls`) and render through the same shared presentation
 * (`review-render.ts`): for an equivalent transaction they must surface the
 * same decoded call summaries and the same risk flags, and neither may silently
 * omit a summary the other shows. A single `verifyCalls` report feeds both
 * renders here, so the assertions prove one decode/risk path, not two that
 * happen to agree.
 */
import { describe, expect, test } from "bun:test";
import { escapeHtml } from "@bramble/core/html";
import type { TokenConfig } from "@bramble/settings/preferences";
import { buildErc20TransferCall, parseTokenAmount } from "@bramble/starknet/rpc";
import { verifyCalls } from "@bramble/transactions/verify";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { Call } from "starknet";
import type { PendingApproval, WalletStatus } from "../../../src/popup/responses/responses";
import { approvalCard } from "../../../src/sidepanel/journeys/approvals/approval-cards";
import { reviewPanelHtml } from "../../../src/sidepanel/journeys/send/transfer-ui";
import {
  reviewCallsList,
  reviewPanel,
  riskFlagMessages,
} from "../../../src/sidepanel/shared/review-render";

type Flag = { readonly code: string; readonly message: string };

// 63-hex addresses so they stay inside the Stark field prime that
// `buildErc20TransferCall` enforces on the recipient.
const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const token: TokenConfig = {
  address: ETH,
  decimals: 18,
  id: `SN_MAIN:ETH:${ETH}`,
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
};

// Same leading 8 and trailing 4 characters as the account, a different account —
// the shared verify layer must flag this as address poisoning.
const POISONED_RECIPIENT = "0x123456ffffffffffffffffffffffffffffffffffffffffffffffffffffbcde";
// An address unlike anything the wallet trusts — a clean transfer, no flags.
const CLEAN_RECIPIENT = "0x777aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc";

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

// Runs the shared verify layer once for a transfer and shapes its output for
// both surfaces, so the two renders are driven by one decode/risk report.
const reviewFor = (
  recipient: string,
): { readonly flags: readonly Flag[]; readonly summaries: readonly string[] } => {
  const call = buildErc20TransferCall(
    token.address,
    recipient,
    parseTokenAmount("1.5", token.decimals),
  );
  const report = verifyCalls([call], { account, addressBook: [], tokens: [token] });
  return {
    flags: report.flags.map((flag) => ({ code: flag.code, message: flag.message })),
    summaries: report.calls.map((decoded) => decoded.summary),
  };
};

// Runs the shared verify layer over an arbitrary call list (multicall, unknown
// selectors, …) and shapes its output for both surfaces from one report.
const reviewForCalls = (
  calls: readonly Call[],
): { readonly flags: readonly Flag[]; readonly summaries: readonly string[] } => {
  const report = verifyCalls(calls, { account, addressBook: [], tokens: [token] });
  return {
    flags: report.flags.map((flag) => ({ code: flag.code, message: flag.message })),
    summaries: report.calls.map((decoded) => decoded.summary),
  };
};

// Fee state both surfaces render through the shared `reviewFeeSection` (#189),
// including the warn-only affordability verdict (#191).
type FeeState = {
  readonly fee: { readonly overallFee: string; readonly unit: string } | null;
  readonly feeAffordability: "insufficient" | "ok" | "unknown";
  readonly feeEstimateFailed: boolean;
  readonly requiresDeployment: boolean;
};

const NO_FEE: FeeState = {
  fee: null,
  feeAffordability: "unknown",
  feeEstimateFailed: false,
  requiresDeployment: false,
};

const dappCard = (
  summaries: readonly string[],
  flags: readonly Flag[],
  fee: FeeState = NO_FEE,
): string => {
  const invoke: PendingApproval = {
    ...fee,
    flags,
    id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14",
    kind: "invoke",
    origin: "https://dapp.example",
    summaries,
  };
  return approvalCard(invoke, status);
};

const sendReview = (
  summaries: readonly string[],
  flags: readonly Flag[],
  fee: FeeState = NO_FEE,
): string =>
  reviewPanelHtml({
    ...fee,
    flags,
    summaries,
  });

describe("Send review vs dApp invoke card decode/risk parity (#19)", () => {
  test("both surfaces render the same decoded summaries as a structured review-calls list", () => {
    const { flags, summaries } = reviewFor(POISONED_RECIPIENT);
    const list = reviewCallsList(summaries);

    // The exact shared-list markup appears in both renders — one rendering path.
    expect(list).toContain('<ul class="review-calls">');
    expect(dappCard(summaries, flags)).toContain(list);
    expect(sendReview(summaries, flags)).toContain(list);

    // No summary the one shows is silently omitted by the other.
    for (const summary of summaries) {
      expect(dappCard(summaries, flags)).toContain(summary);
      expect(sendReview(summaries, flags)).toContain(summary);
    }
  });

  test("a risky transfer surfaces the same risk flag on both surfaces", () => {
    const { flags, summaries } = reviewFor(POISONED_RECIPIENT);

    expect(flags.some((flag) => flag.code === "address-poisoning")).toBe(true);
    const panel = reviewPanel(riskFlagMessages(flags));

    // The exact shared risk-flag panel markup (escaping and all) is present in
    // both renders — proving one panel-rendering path, not two that agree.
    expect(panel).toContain("review-flag");
    expect(dappCard(summaries, flags)).toContain(panel);
    expect(sendReview(summaries, flags)).toContain(panel);
  });

  test("a self-transfer flags on both surfaces from the shared verify layer", () => {
    const { flags, summaries } = reviewFor(account.address);

    expect(flags.some((flag) => flag.code === "self-transfer")).toBe(true);
    const panel = reviewPanel(riskFlagMessages(flags));
    expect(dappCard(summaries, flags)).toContain(panel);
    expect(sendReview(summaries, flags)).toContain(panel);
  });

  test("a clean transfer keeps Send guidance without repeating it in the takeover", () => {
    const { flags, summaries } = reviewFor(CLEAN_RECIPIENT);

    expect(flags).toEqual([]);
    expect(reviewPanel(riskFlagMessages(flags))).toBe("");
    expect(dappCard(summaries, flags)).toContain(reviewCallsList(summaries));
    expect(sendReview(summaries, flags)).toContain(reviewCallsList(summaries));
    // "Risk and recovery" labels the flag list. With nothing flagged, Send
    // still carries its all-clear guidance, but not under that heading.
    expect(dappCard(summaries, flags)).not.toContain("Risk and recovery");
    expect(sendReview(summaries, flags)).not.toContain("Risk and recovery");
    expect(sendReview(summaries, flags)).toContain("No additional wallet warnings were detected.");
  });

  test("a multicall renders every decoded summary in order on both surfaces", () => {
    // transfer + an effectively-unlimited approve: two decoded calls, and the
    // approve raises the unlimited-approval flag from the shared verify layer.
    const transfer = buildErc20TransferCall(
      token.address,
      CLEAN_RECIPIENT,
      parseTokenAmount("2", token.decimals),
    );
    const approve: Call = {
      calldata: [CLEAN_RECIPIENT, "0", "1"],
      contractAddress: token.address,
      entrypoint: "approve",
    };
    const { flags, summaries } = reviewForCalls([transfer, approve]);

    expect(summaries).toHaveLength(2);
    expect(flags.some((flag) => flag.code === "unlimited-approval")).toBe(true);

    // The single shared list carries both summaries, so multicall ordering can
    // not diverge between the two surfaces.
    const list = reviewCallsList(summaries);
    expect(dappCard(summaries, flags)).toContain(list);
    expect(sendReview(summaries, flags)).toContain(list);
    const panel = reviewPanel(riskFlagMessages(flags));
    expect(dappCard(summaries, flags)).toContain(panel);
    expect(sendReview(summaries, flags)).toContain(panel);
  });

  test("the Send-only deployment notice rides in the shared risk panel, not the dApp card", () => {
    // Clean recipient → no verify-layer flags, so the panel carries only the
    // deployment notice and `reviewPanel([notice])` is an exact substring.
    const { flags, summaries } = reviewFor(CLEAN_RECIPIENT);
    expect(flags).toEqual([]);
    const deploymentNotice =
      "This account is not deployed yet; the first send also submits its deployment.";

    const rendered = reviewPanelHtml({
      fee: null,
      feeAffordability: "unknown",
      feeEstimateFailed: false,
      flags,
      requiresDeployment: true,
      summaries,
    });

    // The notice renders through the shared panel with the same review-flag
    // affordance a risk flag uses — not as a bespoke inline paragraph.
    expect(rendered).toContain(reviewPanel([deploymentNotice]));
    // It is Send-specific (informational, not a verify-layer flag) and must not
    // appear on the dApp invoke card for the same decoded transfer.
    expect(dappCard(summaries, flags)).not.toContain(deploymentNotice);
  });

  test("a multicall to two distinct unknown contracts surfaces both on the dApp card", () => {
    // Distinct unknown contracts carry distinct flag messages, so the shared
    // verify layer keeps one flag per contract instead of collapsing them by
    // code — the invoke card must warn about every unknown contract, not just
    // the first. (Send is single-call, so this gap is dApp-only; the shared
    // panel render is what both surfaces would show for the same flags.)
    const first: Call = {
      calldata: ["0x1"],
      contractAddress: "0xaaaa000000000000000000000000000000000000000000000000000000000001",
      entrypoint: "foo",
    };
    const second: Call = {
      calldata: ["0x2"],
      contractAddress: "0xbbbb000000000000000000000000000000000000000000000000000000000002",
      entrypoint: "bar",
    };
    const { flags, summaries } = reviewForCalls([first, second]);

    const unknownFlags = flags.filter((flag) => flag.code === "unknown-contract");
    expect(unknownFlags).toHaveLength(2);

    // The exact shared panel (both distinct flag lines) appears on the card, so
    // no unknown contract past the first is silently dropped from the review.
    const panel = reviewPanel(riskFlagMessages(flags));
    const card = dappCard(summaries, flags);
    expect(card).toContain(panel);
    for (const flag of unknownFlags) {
      expect(card).toContain(escapeHtml(flag.message));
    }
  });

  test("an unknown selector decodes to the same fallback summary on both surfaces", () => {
    const unknown: Call = {
      calldata: ["0x1", "0x2"],
      contractAddress: token.address,
      entrypoint: "frobnicate",
    };
    const { flags, summaries } = reviewForCalls([unknown]);

    // The decoder falls back to a "Call <entrypoint> on <addr>" summary rather
    // than silently dropping the call — the same on both surfaces.
    expect(summaries[0]).toContain("frobnicate");
    const list = reviewCallsList(summaries);
    expect(dappCard(summaries, flags)).toContain(list);
    expect(sendReview(summaries, flags)).toContain(list);
  });
});

// One fee estimate, two surfaces: Send's review and the dApp invoke card must
// render the identical shared fee line for an equivalent transaction, in the
// unit the estimate actually returned (#189). These cases keep the hardcoded
// `fee: null` fixtures above honest — the no-fee state is a state, not the
// only covered state.
describe("Send review vs dApp invoke card fee parity (#189)", () => {
  test("both surfaces render the same estimated fee from one estimate", () => {
    const { flags, summaries } = reviewFor(CLEAN_RECIPIENT);
    const fee: FeeState = {
      fee: { overallFee: "2500000000000000", unit: "FRI" },
      feeAffordability: "unknown",
      feeEstimateFailed: false,
      requiresDeployment: false,
    };

    // The exact shared fee markup appears in both renders — one rendering path.
    const line = '<p class="review-fee">Estimated fee: 0.0025 STRK</p>';
    expect(sendReview(summaries, flags, fee)).toContain(line);
    expect(dappCard(summaries, flags, fee)).toContain(line);
  });

  test("a non-FRI estimate keeps its own unit and is never mislabelled STRK", () => {
    const { flags, summaries } = reviewFor(CLEAN_RECIPIENT);
    const fee: FeeState = {
      fee: { overallFee: "123", unit: "WEI" },
      feeAffordability: "unknown",
      feeEstimateFailed: false,
      requiresDeployment: false,
    };

    for (const rendered of [sendReview(summaries, flags, fee), dappCard(summaries, flags, fee)]) {
      expect(rendered).toContain("Estimated fee: 123 WEI");
      expect(rendered).not.toContain("STRK");
    }
  });

  test("an undeployed account reuses Send's existing wording on both surfaces", () => {
    const { flags, summaries } = reviewFor(CLEAN_RECIPIENT);
    const fee: FeeState = {
      fee: null,
      feeAffordability: "unknown",
      feeEstimateFailed: false,
      requiresDeployment: true,
    };
    const line = "The network fee is estimated once this account is deployed.";

    expect(sendReview(summaries, flags, fee)).toContain(line);
    expect(dappCard(summaries, flags, fee)).toContain(line);
  });

  test("a failed estimate surfaces the same alert and a retry affordance on both surfaces", () => {
    const { flags, summaries } = reviewFor(CLEAN_RECIPIENT);
    const fee: FeeState = {
      fee: null,
      feeAffordability: "unknown",
      feeEstimateFailed: true,
      requiresDeployment: false,
    };
    const alert = "Couldn't estimate the network fee right now.";

    const send = sendReview(summaries, flags, fee);
    expect(send).toContain(alert);
    expect(send).toContain('id="review-retry-fee"');

    const card = dappCard(summaries, flags, fee);
    expect(card).toContain(alert);
    expect(card).toContain('data-approval-retry-fee="b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14"');
    // Both submission surfaces fail closed until the fee can be reviewed.
    expect(card).toContain(
      'data-approval-action="approve" data-approval-id="b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14" type="button" disabled',
    );
  });
});

// Warn-only affordability guard (issue 191): the shared predicate's verdict
// renders the same shortfall notice on both surfaces, makes no claim when
// unknown, and never disables a decision.
describe("fee shortfall warning parity (issue 191)", () => {
  const NOTICE = "STRK balance is less than this transaction needs";
  const feeWith = (feeAffordability: FeeState["feeAffordability"]): FeeState => ({
    fee: { overallFee: "1000", unit: "FRI" },
    feeAffordability,
    feeEstimateFailed: false,
    requiresDeployment: false,
  });

  test("an insufficient verdict renders the shortfall notice on both surfaces", () => {
    const { flags, summaries } = reviewFor(CLEAN_RECIPIENT);
    const fee = feeWith("insufficient");

    expect(sendReview(summaries, flags, fee)).toContain(NOTICE);
    const card = dappCard(summaries, flags, fee);
    expect(card).toContain(NOTICE);
    // Warn-only: the shortfall never disables the card's decision buttons.
    expect(card).not.toContain('type="button" disabled');
  });

  test("ok and unknown verdicts make no shortfall claim on either surface", () => {
    const { flags, summaries } = reviewFor(CLEAN_RECIPIENT);
    for (const verdict of ["ok", "unknown"] as const) {
      expect(sendReview(summaries, flags, feeWith(verdict))).not.toContain(NOTICE);
      expect(dappCard(summaries, flags, feeWith(verdict))).not.toContain(NOTICE);
    }
  });
});
