/**
 * Review lines render in the reader's language only when their reference
 * states exactly the facts of the English the background checked.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { reviewEnglish, reviewText } from "@bramble/transactions/review-messages";
import { setUiLocale } from "../../src/i18n/locale";
import { reviewLine, reviewLines } from "../../src/i18n/review";
import { isOptionalSummaryTexts, isReviewedRiskFlag } from "../../src/popup/responses/review-flags";
import { riskFlagMessages } from "../../src/sidepanel/shared/review-render";

afterEach(() => setUiLocale("en"));

const send = reviewText("review.call.send", { amount: "1.5 STRK", to: "0x1234…abcd" });
const english = reviewEnglish(send);

describe("reviewLine", () => {
  test("English readers always get the background's English", () => {
    expect(reviewLine(send, "something else entirely")).toBe("something else entirely");
  });

  test("Chinese readers get the reference rendered with the same facts", () => {
    setUiLocale("zh-Hans");
    expect(reviewLine(send, english)).toBe("发送 1.5 STRK 至 0x1234…abcd");
  });

  test("a reference that disagrees with the English is ignored", () => {
    setUiLocale("zh-Hans");
    const other = reviewText("review.call.send", { amount: "1500 STRK", to: "0x1234…abcd" });
    expect(reviewLine(other, english)).toBe(english);
  });

  test("a missing or unrenderable reference falls back to English", () => {
    setUiLocale("zh-Hans");
    expect(reviewLine(undefined, english)).toBe(english);
    expect(reviewLine({ facts: {}, key: "review.call.send" }, english)).toBe(english);
    expect(reviewLine({ facts: {}, key: "review.call.nope" }, english)).toBe(english);
  });

  test("lines pair with references only when the counts match", () => {
    setUiLocale("zh-Hans");
    expect(reviewLines([english], [send])).toEqual(["发送 1.5 STRK 至 0x1234…abcd"]);
    expect(reviewLines([english, "Call x on 0x1"], [send])).toEqual([english, "Call x on 0x1"]);
  });

  test("risk flags render through the same path", () => {
    setUiLocale("zh-Hans");
    const flag = reviewText("review.flag.selfTransfer");
    expect(riskFlagMessages([{ message: reviewEnglish(flag), text: flag }])).toEqual([
      "收款地址是此钱包自己的地址。",
    ]);
  });
});

describe("panel validators", () => {
  test("a flag may carry a valid reference and nothing else", () => {
    const base = { code: "self-transfer", message: "The recipient is this wallet's own address." };
    expect(isReviewedRiskFlag(base)).toBe(true);
    expect(isReviewedRiskFlag({ ...base, text: reviewText("review.flag.selfTransfer") })).toBe(
      true,
    );
    expect(isReviewedRiskFlag({ ...base, text: { facts: {}, key: "review.flag.nope" } })).toBe(
      false,
    );
    expect(isReviewedRiskFlag({ ...base, extra: true })).toBe(false);
  });

  test("summary references must pair one to one with the English lines", () => {
    expect(isOptionalSummaryTexts(undefined, 2)).toBe(true);
    expect(isOptionalSummaryTexts([send], 1)).toBe(true);
    expect(isOptionalSummaryTexts([send], 2)).toBe(false);
    expect(isOptionalSummaryTexts([{ facts: {}, key: "x.y" }], 1)).toBe(false);
  });
});
