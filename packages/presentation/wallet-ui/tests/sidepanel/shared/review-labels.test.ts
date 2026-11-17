/**
 * A review box label must be true of what it labels (docs/COPY_STYLE.md rule
 * 7). "Cost" sits over fee lines only; a constraint such as "the signed result
 * can still authorize site-specific actions" is not fee information, so the
 * constraint box says "Cost and limits" (mc-wallet #476).
 */
import { describe, expect, test } from "bun:test";
import { reviewConstraints, reviewCostNote } from "../../../src/sidepanel/shared/review-render";

describe("review box labels", () => {
  test("constraints are labelled as limits, not as cost alone", () => {
    const html = reviewConstraints("The signed result can still authorize site-specific actions.");
    expect(html).toContain('aria-label="Cost and limits"');
    expect(html).toContain('class="decision-label">Cost and limits<');
    expect(html).not.toContain('aria-label="Cost"');
  });

  test("a fee line keeps the Cost label and escapes its text", () => {
    const html = reviewCostNote("Maximum network fee: <b>1</b> STRK");
    expect(html).toContain('aria-label="Cost"');
    expect(html).toContain('class="decision-label">Cost<');
    expect(html).toContain("&lt;b&gt;1&lt;/b&gt;");
  });
});
