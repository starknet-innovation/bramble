/**
 * A shield short of public STRK says how much it needs and how much to add
 * (issue 665). The figure is the pool fee, the network fee at the ceiling the
 * submission is held to (so "up to" is true), and the amount when the token is
 * STRK. Rounding only ever goes up, so adding the shown figure is enough.
 * Confirm stays live by default; blocking is one owner-held constant.
 */

import { describe, expect, test } from "bun:test";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { PrivacyPreparation } from "../../../../src/sidepanel/journeys/privacy/privacy-runtime";
import type { TransferFields } from "../../../../src/sidepanel/journeys/send/transfer-model";
import { shieldStrkFunding } from "../../../../src/sidepanel/journeys/send/transfer-route";
import {
  BLOCK_CONFIRM_WHEN_SHIELD_STRK_SHORT,
  confirmBlocked,
  preparedReview,
  preparedState,
  shieldStrkBlocked,
} from "../../../../src/sidepanel/journeys/send/transfer-submit";
import { reviewFeeSection } from "../../../../src/sidepanel/shared/review-render";
import { context, registered, strkBalance } from "../../../support/compose-fee-fixtures";

const STRK = 10n ** 18n;
const GENERIC = "This account's STRK balance is less than";

const shieldFields = (fields: Partial<TransferFields>): TransferFields =>
  context(
    { privacy: registered, recipientRegistration: "registered" },
    {
      amount: "1",
      destination: "private",
      tokenAddress: STRK_TOKEN_ADDRESS,
      tokenDecimals: "18",
      tokenId: strkBalance.id,
      tokenSymbol: "STRK",
      ...fields,
    },
  ).fields;
const ethFields = shieldFields({ tokenAddress: "0x9", tokenId: "eth", tokenSymbol: "ETH" });

const preparation = (fee: { overallFee: string; unit: string } | null) =>
  ({
    id: `sha256:${"b".repeat(64)}`,
    kind: "deposit",
    ...(fee === null ? {} : { networkFee: fee }),
    payloadDigest: `sha256:${"b".repeat(64)}`,
    poolAddress: "0x123",
    poolFeeFri: `0x${(2n * STRK).toString(16)}`,
    route: "public-account",
    summaries: ["Shield"],
    symbol: "STRK",
    tokenId: strkBalance.id,
  }) as unknown as PrivacyPreparation;
const fri = (overallFee: bigint) => preparation({ overallFee: overallFee.toString(), unit: "FRI" });
const balances = (raw: bigint) => [{ ...strkBalance, balance: raw.toString() }];
const reviewOf = (fields: TransferFields, prep: PrivacyPreparation, balance: bigint) =>
  preparedReview(prep, shieldStrkFunding(fields, balances(balance), prep.poolFeeFri));
const cost = (review: ReturnType<typeof preparedReview>) =>
  reviewFeeSection(review, { id: "review-retry-fee" });

describe("a shield's STRK need at review", () => {
  test("counts the network fee at its signing ceiling, not the estimate", () => {
    // 2 STRK pool fee + a 1000 FRI estimate: the balance covers the estimate
    // (1000) but not the 1500 FRI ceiling the submission may sign for.
    const review = reviewOf(ethFields, fri(1000n), 2n * STRK + 1200n);
    expect(review.feeAffordability).toBe("ok");
    expect(review.shieldStrkNeed).toEqual({
      includesAmount: false,
      need: 2n * STRK + 1500n,
      short: 300n,
    });
    expect(cost(review)).toContain(
      "This shield needs up to 2.000001 STRK in fees. Add 0.000001 STRK, then review again.",
    );
  });

  test("includes the amount for a STRK shield", () => {
    const review = reviewOf(shieldFields({ amount: "10" }), fri(STRK), 12n * STRK);
    expect(review.shieldStrkNeed).toEqual({
      includesAmount: true,
      need: 12n * STRK + (3n * STRK) / 2n,
      short: (3n * STRK) / 2n,
    });
    const html = cost(review);
    expect(html).toContain(
      "This shield needs up to 13.5 STRK, including the amount. Add 1.5 STRK, then review again.",
    );
    expect(html).not.toContain(GENERIC);
    expect(html).toContain('role="alert"');
  });

  test("a balance exactly at the need says nothing, one unit under says to add", () => {
    const need = 2n * STRK + 1500n;
    const exact = reviewOf(ethFields, fri(1000n), need);
    expect(exact.shieldStrkNeed?.short).toBe(0n);
    expect(cost(exact)).not.toContain("This shield needs");
    expect(cost(exact)).not.toContain(GENERIC);
    expect(cost(reviewOf(ethFields, fri(1000n), need - 1n))).toContain("Add 0.000001 STRK");
  });

  test("rounds a figure up to the shown precision, never down", () => {
    // 1e12 FRI is exactly 0.000001 STRK; one more must show as 0.000002.
    const step = 10n ** 12n;
    const need = 2n * STRK + ((3n * step) / 2n) * 2n;
    const prep = fri(step * 2n);
    expect(cost(reviewOf(ethFields, prep, need - step))).toContain("Add 0.000001 STRK");
    expect(cost(reviewOf(ethFields, prep, need - step - 1n))).toContain("Add 0.000002 STRK");
    expect(cost(reviewOf(ethFields, prep, 0n))).toContain("needs up to 2.000003 STRK in fees");
  });

  test("makes no claim without an FRI network fee, a STRK balance, or off the shield route", () => {
    expect(reviewOf(ethFields, preparation(null), 0n).shieldStrkNeed).toBeUndefined();
    expect(
      reviewOf(ethFields, preparation({ overallFee: "1", unit: "WEI" }), 0n).shieldStrkNeed,
    ).toBeUndefined();
    expect(
      preparedReview(fri(1000n), shieldStrkFunding(ethFields, [], fri(1000n).poolFeeFri))
        .shieldStrkNeed,
    ).toBeUndefined();
    const relayed = { ...fri(1000n), route: "private-relay" } as PrivacyPreparation;
    expect(
      preparedReview(relayed, shieldStrkFunding(ethFields, balances(0n), relayed.poolFeeFri))
        .shieldStrkNeed,
    ).toBeUndefined();
  });
});

describe("Confirm on a shield short of STRK", () => {
  const short = reviewOf(ethFields, fri(1000n), 0n);
  const covered = reviewOf(ethFields, fri(1000n), 3n * STRK);

  test("stays warn-only by default: the reviewed key is kept", () => {
    expect(BLOCK_CONFIRM_WHEN_SHIELD_STRK_SHORT).toBe(false);
    expect(shieldStrkBlocked(short)).toBe(false);
    const state = preparedState(fri(1000n), ethFields, "key-1", balances(0n));
    expect(state.reviewedKey).toBe("key-1");
    expect(state.error).toBe("");
    expect(confirmBlocked(short)).toBe(false);
    // The fee-failure block is unchanged beside it.
    expect(confirmBlocked({ ...short, feeEstimateFailed: true })).toBe(true);
  });

  test("blocks only a known shortfall when the owner turns blocking on", () => {
    expect(shieldStrkBlocked(short, true)).toBe(true);
    expect(shieldStrkBlocked(covered, true)).toBe(false);
    expect(shieldStrkBlocked(reviewOf(ethFields, preparation(null), 0n), true)).toBe(false);
  });
});
