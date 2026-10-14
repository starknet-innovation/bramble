/**
 * A STRK shield pays its network fee, the pool fee, and the amount from the
 * same public STRK balance. Max holds back only the pool fee, because the
 * deposit's network fee is unknown until it is proved; so the Amount screen
 * says to leave STRK for the network fee when the amount takes it all, and
 * the review warns when the proved network fee does not fit (user feedback
 * 2026-10-14, point 5).
 */

import { describe, expect, test } from "bun:test";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { PrivacyPreparation } from "../../../../src/sidepanel/journeys/privacy/privacy-runtime";
import {
  composeFeeLines,
  composeFeeTarget,
} from "../../../../src/sidepanel/journeys/send/transfer-compose-fee";
import type { TransferFields } from "../../../../src/sidepanel/journeys/send/transfer-model";
import {
  shieldLeavesNoStrkForGas,
  shieldStrkFunding,
  transferSpendable,
} from "../../../../src/sidepanel/journeys/send/transfer-route";
import { preparedReview } from "../../../../src/sidepanel/journeys/send/transfer-submit";
import { reviewFeeSection } from "../../../../src/sidepanel/shared/review-render";
import { context, registered, review, strkBalance } from "../../../support/compose-fee-fixtures";

const NOTE = "Leave enough STRK for the network fee.";
const STRK = 10n ** 18n;
// 50 STRK public, 2 STRK pool fee: Max fills in 48.
const shield = (fields: Partial<TransferFields>) =>
  context(
    { privacy: registered, recipientRegistration: "registered" },
    {
      destination: "private",
      tokenAddress: STRK_TOKEN_ADDRESS,
      tokenDecimals: "18",
      tokenId: strkBalance.id,
      tokenSymbol: "STRK",
      ...fields,
    },
  );

describe("the Amount screen for a STRK shield", () => {
  test("Max holds back the pool fee only", () => {
    expect(transferSpendable(shield({ amount: "1" }))).toBe(48n * STRK);
  });

  test("says to leave STRK for the network fee when the amount takes it all", () => {
    const target = composeFeeTarget(shield({ amount: "48" }));
    if (target === null) throw new Error("expected a priceable shield");
    expect(target.leavesNoGas).toBe(true);
    expect(composeFeeLines(target, { failed: false, review: review() })).toEqual([
      "Pool fee: 2 STRK from your public balance",
      NOTE,
    ]);
  });

  test("says nothing extra when STRK is left over", () => {
    const target = composeFeeTarget(shield({ amount: "47.5" }));
    if (target === null) throw new Error("expected a priceable shield");
    expect(target.leavesNoGas).toBe(false);
    expect(composeFeeLines(target, { failed: false, review: review() })).not.toContain(NOTE);
  });

  test("never applies to a token other than STRK, even at its Max", () => {
    const eth = context(
      { privacy: registered, recipientRegistration: "registered" },
      { amount: "1", destination: "private" },
    );
    const max = transferSpendable(eth);
    if (max === null) throw new Error("expected a spendable ETH shield");
    const atMax = { ...eth, fields: { ...eth.fields, amount: (max / STRK).toString() } };
    expect(shieldLeavesNoStrkForGas(atMax)).toBe(false);
  });

  test("never applies to another token, another route, or an unread pool fee", () => {
    expect(shieldLeavesNoStrkForGas(context({ privacy: registered }, { amount: "100" }))).toBe(
      false,
    );
    expect(
      shieldLeavesNoStrkForGas(
        context({ privacy: registered }, { amount: "48", tokenAddress: STRK_TOKEN_ADDRESS }),
      ),
    ).toBe(false);
    expect(
      shieldLeavesNoStrkForGas({
        ...shield({ amount: "48" }),
        privacy: { ...registered, value: null },
      }),
    ).toBe(false);
  });
});

describe("the review of a shield", () => {
  const preparation = (networkFee: string | null) =>
    ({
      id: `sha256:${"a".repeat(64)}`,
      kind: "deposit",
      ...(networkFee === null ? {} : { networkFee: { overallFee: networkFee, unit: "FRI" } }),
      payloadDigest: `sha256:${"a".repeat(64)}`,
      poolAddress: "0x123",
      poolFeeFri: `0x${(2n * STRK).toString(16)}`,
      route: "public-account",
      summaries: ["Shield 48 STRK"],
      symbol: "STRK",
      tokenId: strkBalance.id,
    }) as unknown as PrivacyPreparation;
  const funding = (amount: string) =>
    shieldStrkFunding(shield({ amount }).fields, [strkBalance], preparation(null).poolFeeFri);

  test("warns when the balance cannot also cover the proved network fee", () => {
    expect(funding("48")).toEqual({ balance: strkBalance.balance, spent: 50n * STRK });
    expect(preparedReview(preparation("1000"), funding("48")).feeAffordability).toBe(
      "insufficient",
    );
  });

  test("the shield's Cost box shows the existing shortfall notice", () => {
    const html = reviewFeeSection(preparedReview(preparation("1000"), funding("48")), {
      id: "review-retry-fee",
    });
    expect(html).toContain("This account's STRK balance is less than this transaction needs");
  });

  test("is satisfied when it can", () => {
    expect(preparedReview(preparation("1000"), funding("47")).feeAffordability).toBe("ok");
  });

  test("counts only the pool fee for a token other than STRK", () => {
    const ethShield = shield({ amount: "48", tokenAddress: "0x9" }).fields;
    expect(shieldStrkFunding(ethShield, [strkBalance], preparation(null).poolFeeFri)).toEqual({
      balance: strkBalance.balance,
      spent: 2n * STRK,
    });
  });

  test("makes no claim without a network fee, a STRK balance, or off the shield route", () => {
    expect(preparedReview(preparation(null), funding("48")).feeAffordability).toBe("unknown");
    expect(
      preparedReview(
        preparation("1000"),
        shieldStrkFunding(shield({ amount: "48" }).fields, [], preparation(null).poolFeeFri),
      ).feeAffordability,
    ).toBe("unknown");
    expect(preparedReview(preparation("1000")).feeAffordability).toBe("unknown");
    expect(
      shieldStrkFunding(context().fields, [strkBalance], preparation(null).poolFeeFri),
    ).toBeNull();
    const relayed = { ...preparation("1000"), route: "private-relay" } as PrivacyPreparation;
    expect(preparedReview(relayed, funding("48")).feeAffordability).toBe("unknown");
  });
});
