/**
 * Reason logic behind a transfer review's fee outcome: an undeployed account
 * yields an intentional null fee (not a failure), a deployed account with an
 * estimate keeps that fee, and a deployed account without one is flagged as a
 * genuine estimate failure so the UI can offer a retry — carrying the node's own
 * reason, which is the only thing separating a dead connection from a revert.
 */
import { describe, expect, test } from "bun:test";
import { resolveReviewFee } from "../../../apps/extension/src/background/accounts/wallet-ops";
import {
  account,
  extensionSender,
  makeWalletOpsHarness,
  tokenId,
} from "../../support/wallet-ops-harness";

const fee = { overallFee: "2500000000000000", unit: "FRI" } as const;

describe("resolveReviewFee", () => {
  test("keeps the estimate for a deployed account", () => {
    expect(resolveReviewFee({ deployed: true, fee })).toEqual({
      fee,
      feeEstimateFailed: false,
    });
  });

  test("flags a deployed account with no estimate as a failure", () => {
    expect(resolveReviewFee({ deployed: true, fee: null })).toEqual({
      fee: null,
      feeEstimateFailed: true,
    });
  });

  test("treats an undeployed account's null fee as intentional, not a failure", () => {
    expect(resolveReviewFee({ deployed: false, fee: null })).toEqual({
      fee: null,
      feeEstimateFailed: false,
    });
  });

  test("does not surface a fee for an undeployed account even if one is passed", () => {
    expect(resolveReviewFee({ deployed: false, fee })).toEqual({
      fee: null,
      feeEstimateFailed: false,
    });
  });
});

const reviewMessage = {
  accountId: account.id,
  amount: "1.5",
  recipient: "0x777",
  tokenId,
  type: "wallet.reviewTransfer",
};

const review = async (
  options?: Parameters<typeof makeWalletOpsHarness>[0],
): Promise<Record<string, unknown>> => {
  const { handler } = makeWalletOpsHarness(options);
  const response = (await handler(reviewMessage, extensionSender)) as {
    readonly review: Record<string, unknown>;
  };
  return response.review;
};

describe("transfer review failure reason", () => {
  test("reports the node's reason rather than only a generic failure", async () => {
    expect(await review({ deployed: true, estimateFails: true })).toMatchObject({
      fee: null,
      feeEstimateDetail: "rpc unavailable",
      feeEstimateFailed: true,
    });
  });

  test("reports an RPC rejection's reason without its request body", async () => {
    // starknet.js puts the request params — including calldata — in `message`
    // and the explanation in `baseError`. Only the latter may be shown.
    const rejection = Object.assign(
      new Error('RPC: starknet_estimateFee with params {"request":[{"calldata":["0xabc"]}]}'),
      {
        baseError: {
          code: 41,
          data: { execution_error: "Execution failed: ERC20: insufficient balance" },
          message: "Transaction execution error",
        },
      },
    );
    const failed = await review({ deployed: true, estimateError: rejection });

    expect(failed["feeEstimateDetail"]).toBe(
      "41 Transaction execution error Execution failed: ERC20: insufficient balance",
    );
    expect(failed["feeEstimateDetail"]).not.toContain("0xabc");
  });

  test("omits the field entirely when the estimate succeeds", async () => {
    const succeeded = await review({ deployed: true });

    expect(succeeded["feeEstimateFailed"]).toBe(false);
    expect(Object.hasOwn(succeeded, "feeEstimateDetail")).toBe(false);
  });

  test("omits the field for an undeployed account, which never estimates", async () => {
    const undeployed = await review({ deployed: false });

    expect(undeployed["feeEstimateFailed"]).toBe(false);
    expect(Object.hasOwn(undeployed, "feeEstimateDetail")).toBe(false);
  });
});
