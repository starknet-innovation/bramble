/**
 * Token detection keeps the rows the token store accepts (Sherlock 207): one
 * refused suggestion, such as the curated bridged-USDC ticker the shared symbol
 * rule rejects, must not discard every other token the account holds.
 */
import { describe, expect, test } from "bun:test";
import { detectTokensResponse, runtimeReturning } from "../../support/runtime-client-fixtures";

describe("createSidepanelRuntime — detectTokens", () => {
  test("detectTokens drops a row the token store would refuse and keeps the rest (Sherlock 207)", async () => {
    const [good] = detectTokensResponse.suggestions;
    if (!good) throw new Error("fixture has no suggestion");
    // The curated bridged-USDC ticker, which the shared symbol rule refuses.
    const refused = { ...good, symbol: "USDC.e" };
    expect(
      await runtimeReturning({ ok: true, suggestions: [refused, good, good] }).detectTokens(),
    ).toEqual([good]);
  });
});
