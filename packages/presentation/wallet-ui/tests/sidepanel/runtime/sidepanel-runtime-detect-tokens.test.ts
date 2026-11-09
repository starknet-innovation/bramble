/**
 * Token detection keeps the rows the token store accepts (Sherlock 207): one
 * refused suggestion must not discard every other token the account holds,
 * and the curated bridged-USDC ticker is now one the store accepts (issue 645).
 */
import { describe, expect, test } from "bun:test";
import { detectTokensResponse, runtimeReturning } from "../../support/runtime-client-fixtures";

describe("createSidepanelRuntime — detectTokens", () => {
  test("detectTokens drops a row the token store would refuse and keeps the rest (Sherlock 207)", async () => {
    const [good] = detectTokensResponse.suggestions;
    if (!good) throw new Error("fixture has no suggestion");
    // A ticker the shared symbol rule refuses, under its own consistent id.
    const refused = { ...good, id: good.id.replace(":USDC:", ":USDC-e:"), symbol: "USDC-e" };
    expect(
      await runtimeReturning({ ok: true, suggestions: [refused, good, good] }).detectTokens(),
    ).toEqual([good]);
  });

  test("detectTokens keeps the curated bridged USDC.e row (issue 645)", async () => {
    const [good] = detectTokensResponse.suggestions;
    if (!good) throw new Error("fixture has no suggestion");
    const bridged = { ...good, id: good.id.replace(":USDC:", ":USDC.e:"), symbol: "USDC.e" };
    expect(
      await runtimeReturning({ ok: true, suggestions: [bridged, good] }).detectTokens(),
    ).toEqual([bridged, good]);
  });
});
