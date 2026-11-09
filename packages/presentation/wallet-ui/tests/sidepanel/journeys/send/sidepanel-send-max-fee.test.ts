/**
 * Max on a public STRK send leaves room for the network fee (mc-wallet 720).
 * The fee is paid from the same STRK, so Max keeps back the most the wallet
 * will sign: the reviewed fee, plus a first deployment's, raised by the
 * headroom the submission is held to. Until that fee is known Max fills
 * nothing, and every other token and route is unchanged.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  exceedsReviewedFee,
  REVIEWED_FEE_HEADROOM,
  reviewedFeeCeiling,
} from "@bramble/starknet/fee-bounds";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { createComposeFee } from "../../../../src/sidepanel/journeys/send/transfer-compose-fee";
import {
  feeReserveFor,
  transferMaxSpendable,
} from "../../../../src/sidepanel/journeys/send/transfer-max";
import type { TransferFields } from "../../../../src/sidepanel/journeys/send/transfer-model";
import { transferSpendable } from "../../../../src/sidepanel/journeys/send/transfer-route";
import type { TransferReview } from "../../../../src/sidepanel/journeys/send/transfer-submit";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import {
  context,
  DEPLOYMENT_FEE,
  registered,
  review,
  strkBalance,
} from "../../../support/compose-fee-fixtures";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const STRK = 10n ** 18n;
// review(): a 0.002 STRK fee, so its ceiling is 0.003 STRK.
const FEE_CEILING = 3_000_000_000_000_000n;
// With DEPLOYMENT_FEE (0.001): 0.003 combined, ceiling 0.0045.
const DEPLOY_CEILING = 4_500_000_000_000_000n;

const strkFields: Partial<TransferFields> = {
  tokenAddress: STRK_TOKEN_ADDRESS,
  tokenDecimals: "18",
  tokenId: strkBalance.id,
  tokenSymbol: "STRK",
};
const strkSend = (fields: Partial<TransferFields> = {}) =>
  context({}, { ...strkFields, amount: "1", ...fields });

describe("the fee ceiling Max keeps back", () => {
  test("is the reviewed fee raised by the headroom the submission is held to", () => {
    expect(reviewedFeeCeiling({ overallFee: "2000000000000000", unit: "FRI" })).toBe(FEE_CEILING);
    expect(REVIEWED_FEE_HEADROOM).toEqual({ denominator: 2, numerator: 3 });
  });

  test("covers every spend the submission would accept, and nothing above it", () => {
    for (const fee of ["2000000000000000", "3", "1"]) {
      const reviewed = { overallFee: fee, unit: "FRI" as const };
      const ceiling = reviewedFeeCeiling(reviewed);
      if (ceiling === null) throw new Error("expected a ceiling");
      expect(exceedsReviewedFee(reviewed, { overallFee: ceiling.toString(), unit: "FRI" })).toBe(
        false,
      );
      expect(
        exceedsReviewedFee(reviewed, { overallFee: (ceiling + 1n).toString(), unit: "FRI" }),
      ).toBe(true);
    }
  });

  test("is unknown for a figure that is not base units", () => {
    expect(reviewedFeeCeiling({ overallFee: "0.002", unit: "FRI" })).toBeNull();
  });

  test("is unknown without a usable review", () => {
    expect(feeReserveFor(null)).toBeNull();
    expect(feeReserveFor(review({ feeEstimateFailed: true }))).toBeNull();
    expect(feeReserveFor(review({ fee: null }))).toBeNull();
    expect(feeReserveFor(review({ fee: { overallFee: "2", unit: "WEI" } }))).toBeNull();
    expect(feeReserveFor(review({ requiresDeployment: true }))).toBeNull();
    expect(
      feeReserveFor(review({ deploymentFeeEstimateFailed: true, requiresDeployment: true })),
    ).toBeNull();
  });
});

describe("Max on a public STRK send", () => {
  test("fills the balance less the fee ceiling", () => {
    expect(transferMaxSpendable(strkSend(), review())).toBe(50n * STRK - FEE_CEILING);
  });

  test("also keeps back the deployment when the account must deploy first", () => {
    const deploying = review({ deploymentFee: DEPLOYMENT_FEE, requiresDeployment: true });
    expect(transferMaxSpendable(strkSend(), deploying)).toBe(50n * STRK - DEPLOY_CEILING);
  });

  test("fills nothing while the fee is unknown", () => {
    expect(transferMaxSpendable(strkSend(), null)).toBeNull();
    expect(transferMaxSpendable(strkSend(), review({ feeEstimateFailed: true }))).toBeNull();
  });

  test("never goes below zero when the fee takes the whole balance", () => {
    const tiny = context(
      {
        publicBalances: [{ ...strkBalance, balance: "1000000000000000", formatted: "0.001" }],
      },
      { ...strkFields, amount: "0.0001" },
    );
    expect(transferMaxSpendable(tiny, review())).toBe(0n);
  });
});

describe("everything else is unchanged", () => {
  test("Max on ETH sends the whole balance, whatever the fee", () => {
    const eth = context({}, { amount: "1" });
    expect(transferMaxSpendable(eth, null)).toBe(100n * STRK);
    expect(transferMaxSpendable(eth, review())).toBe(transferSpendable(eth));
  });

  test("Max on USDC sends the whole balance", () => {
    const usdcAddress = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
    const usdc = {
      address: usdcAddress,
      balance: "25000000",
      decimals: 6,
      formatted: "25",
      id: `SN_MAIN:USDC:${usdcAddress}`,
      name: "USD Coin",
      networkId: "SN_MAIN" as const,
      symbol: "USDC",
    };
    const send = context(
      { publicBalances: [usdc, strkBalance] },
      {
        amount: "1",
        tokenAddress: usdcAddress,
        tokenDecimals: "6",
        tokenId: usdc.id,
        tokenSymbol: "USDC",
      },
    );
    expect(transferMaxSpendable(send, null)).toBe(25_000_000n);
  });

  test("a STRK shield still holds back only the pool fee", () => {
    const shield = context(
      { privacy: registered, recipientRegistration: "registered" },
      { ...strkFields, amount: "1", destination: "private" },
    );
    expect(transferMaxSpendable(shield, null)).toBe(48n * STRK);
    expect(transferMaxSpendable(shield, null)).toBe(transferSpendable(shield));
  });
});

describe("the Amount screen prices a STRK send before an amount is typed", () => {
  const subject = (fields: Partial<TransferFields>) => {
    const form = document.createElement("form");
    const region = document.createElement("div");
    region.id = "send-fee-lines";
    form.append(region);
    document.body.append(form);
    const amounts: string[] = [];
    let resolve: (value: TransferReview) => void = () => undefined;
    const wallet = {
      reviewTransfer: (_a: string, _t: string, _r: string, amount: string) => {
        amounts.push(amount);
        return new Promise<TransferReview>((done) => {
          resolve = done;
        });
      },
    } as unknown as SidepanelWallet;
    const fee = createComposeFee({
      context: () => context({}, fields),
      form,
      schedule: (_delay, run) => {
        run();
        return () => undefined;
      },
      stage: () => "details",
      wallet,
    });
    return { amounts, fee, resolve: (value: TransferReview) => resolve(value) };
  };

  test("prices it at a nominal amount so Max can keep the fee back", async () => {
    const { amounts, fee, resolve } = subject({ ...strkFields, amount: "" });
    expect(amounts).toEqual(["0.000000000000000001"]);
    expect(fee.review()).toBeNull();
    resolve(review());
    await Promise.resolve();
    expect(fee.review()).toEqual(review());
  });

  test("does not pre-price a send of another token", () => {
    const { amounts } = subject({ amount: "" });
    expect(amounts).toEqual([]);
  });

  test("keeps the review of a priced amount for Max", async () => {
    const { fee, resolve } = subject({ ...strkFields, amount: "5" });
    resolve(review());
    await Promise.resolve();
    expect(fee.review()).toEqual(review());
  });
});
