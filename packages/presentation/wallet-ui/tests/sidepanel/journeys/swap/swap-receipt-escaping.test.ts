/** Swap confirmation interpolations remain safe at the privileged HTML sink. */

import { describe, expect, test } from "bun:test";
import { swapConfirmReceipt } from "../../../../src/sidepanel/journeys/swap/swap-views";

describe("swap confirmation receipt", () => {
  test("escapes hostile symbols in every receipt location", () => {
    const html = swapConfirmReceipt({
      buyAddress: "0x2",
      buyAmount: "2",
      buySymbol: '<img src=x onerror="alert(1)">',
      gasFeesInUsd: 0,
      lossPercent: 0,
      minBuyAmount: "1.9",
      networkFee: { overallFee: "1", unit: "FRI" },
      sellAddress: "0x1",
      sellAmount: "1",
      sellSymbol: "<script>alert(1)</script>",
      valueDelta: null,
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});
