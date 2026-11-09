/**
 * Issue 484: the pool charges its fee in STRK and hands the review surfaces a
 * canonical felt of STRK base units. A raw felt is not checkable against the
 * balance it will leave, so the summaries render it in STRK. The felt stays the
 * internal form the fee guards compare against; only the display converts.
 */
import { describe, expect, test } from "bun:test";
import { STRK20_MAX_POOL_FEE } from "../../src/policy/fee-policy";
import { formatStrk20PoolFee, summarizeStrk20Plan } from "../../src/policy/summaries";

const SIX_STRK_FELT = "0x53444835ec580000"; // 6 * 10^18 STRK base units

describe("formatStrk20PoolFee", () => {
  test("renders base units as a STRK amount", () => {
    expect(formatStrk20PoolFee(SIX_STRK_FELT)).toBe("6 STRK");
  });

  test("renders a sub-unit fee in full rather than rounding it away", () => {
    expect(formatStrk20PoolFee("0x1")).toBe("0.000000000000000001 STRK");
  });

  test("degrades to the labelled raw felt when the amount is not an integer", () => {
    expect(formatStrk20PoolFee("not-a-fee")).toBe("not-a-fee STRK fri");
  });

  test("keeps the largest admissible fee a short, bounded string", () => {
    // The review validator caps each summary at 256 characters and the account
    // sentence wraps this amount, so the rendered value must stay compact.
    const rendered = formatStrk20PoolFee(`0x${STRK20_MAX_POOL_FEE.toString(16)}`);
    expect(rendered).toBe("340282366920938463463.374607431768211455 STRK");
    expect(rendered.length).toBeLessThan(64);
  });
});

describe("account pool fee summary", () => {
  test("names the fee in STRK and never the raw felt", () => {
    const summary = summarizeStrk20Plan({ mode: "account", poolFeeFri: SIX_STRK_FELT });
    expect(summary).toContain("Public account pool fee 6 STRK");
    expect(summary).not.toContain(SIX_STRK_FELT);
  });
});
