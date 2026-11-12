/**
 * Review sentences: complete in every locale, pinned to their English, and
 * rendered to English exactly as the verifier's `summary` and `message` read.
 */
import { describe, expect, test } from "bun:test";
import { catalogFailures, renderMessageRef } from "@bramble/core/i18n";
import {
  isReviewText,
  reviewEnglish,
  reviewMessages,
  reviewText,
  reviewTextsFor,
  withReviewText,
} from "@bramble/transactions/review-messages";
import { REVIEW_MESSAGE_PINS } from "./review-message-pins";

const pin = (text: string): string =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16);

test("every locale covers every review sentence with the same facts and no markup", () => {
  expect(catalogFailures(reviewMessages)).toEqual([]);
});

test("every translation is pinned to the English it was made from", () => {
  const stale = Object.entries(reviewMessages.en)
    .filter(([key, text]) => REVIEW_MESSAGE_PINS[key] !== pin(text))
    .map(([key, text]) => `${key}: re-translate, then pin ${pin(text)}`);
  expect(stale).toEqual([]);
  expect(Object.keys(REVIEW_MESSAGE_PINS).sort()).toEqual(Object.keys(reviewMessages.en).sort());
});

describe("rendering", () => {
  const text = reviewText("review.call.send", {
    amount: reviewText("review.amount.units", { amount: "7" }),
    to: "0x1234…abcd",
  });

  test("English renders nested facts in place", () => {
    expect(reviewEnglish(text)).toBe("Send 7 units to 0x1234…abcd");
  });

  test("Chinese keeps every fact verbatim", () => {
    const zh = renderMessageRef(text, (key) =>
      Object.hasOwn(reviewMessages["zh-Hans"], key)
        ? reviewMessages["zh-Hans"][key as keyof (typeof reviewMessages)["zh-Hans"]]
        : undefined,
    );
    expect(zh).toBe("发送 7 个最小单位 至 0x1234…abcd");
  });
});

describe("isReviewText", () => {
  test("accepts a known sentence with bounded facts and one nested level", () => {
    expect(isReviewText(reviewText("review.flag.selfTransfer"))).toBe(true);
    expect(
      isReviewText({
        facts: { amount: { facts: { amount: "1" }, key: "review.amount.units" }, to: "0x1" },
        key: "review.call.send",
      }),
    ).toBe(true);
  });

  test("refuses unknown keys, extra fields, empty or oversized facts and deep nesting", () => {
    const unit = { facts: { amount: "1" }, key: "review.amount.units" };
    for (const value of [
      null,
      "review.call.send",
      { facts: {}, key: "review.call.nope" },
      { facts: {}, key: "review.flag.selfTransfer", extra: 1 },
      { key: "review.flag.selfTransfer" },
      { facts: { to: "" }, key: "review.call.send" },
      { facts: { to: "x".repeat(301) }, key: "review.call.send" },
      { facts: { to: 1 }, key: "review.call.send" },
      { facts: { "bad-name": "x" }, key: "review.call.send" },
      {
        facts: { amount: { facts: { amount: unit }, key: "review.call.send" } },
        key: "review.call.send",
      },
      {
        facts: Object.fromEntries([...Array(9)].map((_, i) => [`f${i}`, "x"])),
        key: "review.call.send",
      },
    ]) {
      expect(isReviewText(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe("references only ride when the panel would accept them", () => {
  test("an empty fact drops the reference, never the English", () => {
    expect(
      withReviewText(reviewText("review.call.unknown", { contract: "0x1…2", entrypoint: "" })),
    ).toEqual({});
    const ok = reviewText("review.flag.selfTransfer");
    expect(withReviewText(ok)).toEqual({ text: ok });
  });

  test("lines pair with references only when every line has one", () => {
    const ok = reviewText("review.flag.selfTransfer");
    expect(reviewTextsFor([{ text: ok }, { text: ok }])).toEqual([ok, ok]);
    expect(reviewTextsFor([{ text: ok }, {}])).toBeUndefined();
    expect(reviewTextsFor([])).toEqual([]);
  });
});
