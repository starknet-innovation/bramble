/**
 * References for lines decided outside the verifier ride only when they
 * render to exactly the English line and the panel would accept them.
 */
import { expect, test } from "bun:test";
import { reviewEnglish, reviewText } from "@bramble/transactions/review-messages";
import {
  switchSummaryTexts,
  typedDataSummaryTexts,
} from "../../../apps/extension/src/background/approvals/approval-review-texts";

test("a switch prompt's reference matches the summary the caller decided", () => {
  const { summaryTexts } = switchSummaryTexts("SN_SEPOLIA", "Switch network to Starknet Sepolia");
  expect(summaryTexts?.map(reviewEnglish)).toEqual(["Switch network to Starknet Sepolia"]);
  expect(switchSummaryTexts("SN_SEPOLIA", "Switch network to Somewhere else")).toEqual({});
});

test("a typed-data card pairs its name line with the decoded calls, or carries none", () => {
  const call = reviewText("review.flag.selfTransfer");
  const { summaryTexts } = typedDataSummaryTexts("OutsideExecution · AVNU", [call]);
  expect(summaryTexts?.map(reviewEnglish)).toEqual([
    "OutsideExecution · AVNU",
    reviewEnglish(call),
  ]);
  expect(typedDataSummaryTexts("OutsideExecution", undefined)).toEqual({});
  expect(typedDataSummaryTexts("", [call])).toEqual({});
});
