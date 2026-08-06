/**
 * Pre-sign transfer review response validator: accepts a well-formed review
 * (with and without a fee) and rejects every malformed shape, exercising the
 * nested isFeeShape and isRiskFlagShape guards.
 */
import { describe, expect, test } from "bun:test";
import { isTransferReviewResponse } from "../../src/popup/responses-transfer";

const validReview = () => ({
  fee: { overallFee: "1000", unit: "FRI" },
  feeAffordability: "ok",
  feeEstimateFailed: false,
  flags: [{ code: "unknown-contract", message: "Verify the contract." }],
  requiresDeployment: false,
  summaries: ["Send 1 ETH to 0x0005…0005"],
});

const validResponse = () => ({ ok: true, review: validReview() });

describe("isTransferReviewResponse", () => {
  test("accepts a well-formed review with a fee and a risk flag", () => {
    expect(isTransferReviewResponse(validResponse())).toBe(true);
  });

  test("accepts a review whose fee estimation failed (fee is null)", () => {
    expect(
      isTransferReviewResponse({
        ok: true,
        review: {
          ...validReview(),
          fee: null,
          feeAffordability: "unknown",
          feeEstimateFailed: true,
        },
      }),
    ).toBe(true);
  });

  test("accepts a review with empty flags and summaries", () => {
    expect(
      isTransferReviewResponse({
        ok: true,
        review: { ...validReview(), flags: [], summaries: [] },
      }),
    ).toBe(true);
  });

  test.each([
    ["a non-record value", 42],
    ["null", null],
    ["a non-plain object (array)", []],
    ["ok not true", { ...validResponse(), ok: false }],
    ["an unknown top-level key", { ...validResponse(), extra: 1 }],
    ["a non-record review", { ok: true, review: "nope" }],
    ["a review missing a required key", { ok: true, review: { fee: null } }],
    ["a review with an unknown key", { ok: true, review: { ...validReview(), extra: 1 } }],
  ])("rejects %s", (_label, value) => {
    expect(isTransferReviewResponse(value)).toBe(false);
  });

  test("rejects a fee whose overallFee is not a decimal string (isFeeShape)", () => {
    expect(
      isTransferReviewResponse({
        ok: true,
        review: { ...validReview(), fee: { overallFee: "0x10", unit: "FRI" } },
      }),
    ).toBe(false);
  });

  test("rejects a fee whose unit is not an uppercase ticker (isFeeShape)", () => {
    expect(
      isTransferReviewResponse({
        ok: true,
        review: { ...validReview(), fee: { overallFee: "1000", unit: "fri" } },
      }),
    ).toBe(false);
  });

  test("rejects a fee carrying an unknown key (isFeeShape)", () => {
    expect(
      isTransferReviewResponse({
        ok: true,
        review: { ...validReview(), fee: { extra: 1, overallFee: "1000", unit: "FRI" } },
      }),
    ).toBe(false);
  });

  test("rejects a risk flag whose code violates the slug pattern (isRiskFlagShape)", () => {
    expect(
      isTransferReviewResponse({
        ok: true,
        review: { ...validReview(), flags: [{ code: "Bad Code", message: "x" }] },
      }),
    ).toBe(false);
  });

  test("rejects a risk flag with an empty message (isRiskFlagShape)", () => {
    expect(
      isTransferReviewResponse({
        ok: true,
        review: { ...validReview(), flags: [{ code: "risk", message: "" }] },
      }),
    ).toBe(false);
  });

  test("rejects a non-boolean feeEstimateFailed", () => {
    expect(
      isTransferReviewResponse({
        ok: true,
        review: { ...validReview(), feeEstimateFailed: "no" },
      }),
    ).toBe(false);
  });

  test("rejects a non-array flags field", () => {
    expect(
      isTransferReviewResponse({ ok: true, review: { ...validReview(), flags: "none" } }),
    ).toBe(false);
  });

  test("rejects a summary that is empty or over-long", () => {
    expect(
      isTransferReviewResponse({ ok: true, review: { ...validReview(), summaries: [""] } }),
    ).toBe(false);
    expect(
      isTransferReviewResponse({
        ok: true,
        review: { ...validReview(), summaries: ["a".repeat(301)] },
      }),
    ).toBe(false);
  });
});
