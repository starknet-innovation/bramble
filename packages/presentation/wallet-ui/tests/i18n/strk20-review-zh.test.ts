/**
 * STRK20 and staking review lines decided in the background render in the
 * reader's language only when their reference re-renders to exactly the
 * English line, with every fact verbatim; the panel's validators accept these
 * catalogs' keys and still refuse unknown ones.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { strk20English, strk20Text } from "@bramble/privacy/review-messages";
import type { Strk20SubmissionPlan } from "@bramble/privacy/service";
import { strk20PlanText } from "@bramble/privacy/service";
import { reviewEnglish } from "@bramble/transactions/review-messages";
import { stakingReviewText, stakingValidatorText } from "@bramble/transactions/staking-review";
import { setUiLocale } from "../../src/i18n/locale";
import { reviewLine, reviewLines } from "../../src/i18n/review";
import { isOptionalSummaryTexts } from "../../src/popup/responses/review-flags";

afterEach(() => setUiLocale("en"));

const RECIPIENT = "0x05c4…7e2a";
const TOKEN = "0x04718f…938d";

describe("STRK20 review lines", () => {
  const pay = strk20Text("strk20Review.action.pay", {
    amount: "2.5 STRK",
    recipient: RECIPIENT,
    token: TOKEN,
  });

  test("English readers see the background's English unchanged", () => {
    expect(reviewLine(pay, strk20English(pay))).toBe(
      `Pay 2.5 STRK privately to ${RECIPIENT} (${TOKEN})`,
    );
  });

  test("Chinese renders with every fact verbatim", () => {
    setUiLocale("zh-Hans");
    const line = reviewLine(pay, strk20English(pay));
    expect(line).toBe(`向 ${RECIPIENT} 隐私支付 2.5 STRK（${TOKEN}）`);
  });

  test("a reference that disagrees with the English is ignored", () => {
    setUiLocale("zh-Hans");
    const english = `Pay 25 STRK privately to ${RECIPIENT} (${TOKEN})`;
    expect(reviewLine(pay, english)).toBe(english);
  });

  test("a relay fee line keeps its raw fee, cap, caller and window", () => {
    const plan = {
      authorization: {
        caller: `0x${"7".repeat(64)}`,
        executeAfter: "1700000000",
        executeBefore: "1700000600",
        publicCallCount: 2,
      },
      feeAction: { amount: "0x64", token: `0x${"9".repeat(64)}` },
      mode: "private-relay",
    } as unknown as Strk20SubmissionPlan;
    const text = strk20PlanText(plan);
    setUiLocale("zh-Hans");
    const line = reviewLine(text, strk20English(text));
    for (const fact of ["0x64", `0x${"9".repeat(64)}`, "1700000000", "1700000600", " 2 "]) {
      expect(line).toContain(fact);
    }
    expect(line).not.toContain("Private relay fee");
  });

  test("the panel accepts STRK20 references and refuses unknown keys", () => {
    expect(isOptionalSummaryTexts([pay], 1)).toBe(true);
    expect(isOptionalSummaryTexts([{ facts: {}, key: "strk20Review.nope" }], 1)).toBe(false);
    setUiLocale("zh-Hans");
    const all = strk20Text("strk20Review.balances.all");
    expect(reviewLines([strk20English(all)], [all])).toEqual(["共享所有代币的隐私余额"]);
  });
});

describe("staking review line", () => {
  test("names the validator in the reader's language, address verbatim", () => {
    const staker = `0x${"3".repeat(64)}`;
    const text = stakingReviewText({
      account: "0xacc",
      action: "stake",
      amount: "5",
      member: "none",
      symbol: "STRK",
      validator: stakingValidatorText(staker),
    });
    expect(reviewEnglish(text)).toBe(
      `Stake 5 STRK with validator ${staker}. This approves exactly 5 STRK for its pool.`,
    );
    setUiLocale("zh-Hans");
    expect(reviewLine(text, reviewEnglish(text))).toBe(
      `将 5 STRK 质押给 验证者 ${staker}。这只会为其质押池批准恰好 5 STRK。`,
    );
  });
});
