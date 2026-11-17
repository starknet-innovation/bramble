/**
 * Gasless choices are the background's vetted offers. A fee-only "ok" can
 * still sit beside them when the calls spend the STRK that verdict ignores.
 */
import { describe, expect, test } from "bun:test";
import { reviewFeeSection } from "../../../src/sidepanel/shared/review-render";

const fee = { overallFee: "1", unit: "FRI" as const };
const offer = {
  amount: "1000",
  decimals: 6,
  label: "USDC",
  tokenAddress: "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
};

describe("gasless fee choices", () => {
  test("renders a vetted offer when the fee-only verdict is still ok", () => {
    const html = reviewFeeSection(
      {
        fee,
        feeAffordability: "ok",
        feeEstimateFailed: false,
        gaslessFees: [offer],
      },
      { id: "retry" },
    );
    expect(html).toContain("Pay up to");
    expect(html).toContain("USDC");
    expect(html).toContain(`data-gasless-token="${offer.tokenAddress}"`);
  });

  test("renders nothing extra when no offer was attached", () => {
    const html = reviewFeeSection(
      { fee, feeAffordability: "ok", feeEstimateFailed: false },
      { id: "retry" },
    );
    expect(html).not.toContain("Pay up to");
  });
});
