/**
 * Activity rows show amounts to at most four decimal places, trimming longer
 * figures and leaving shorter ones untouched; identifiers are never altered.
 */
import { describe, expect, test } from "bun:test";
import { compactSummary } from "../../../../src/sidepanel/journeys/portfolio/activity-format";

describe("compactSummary", () => {
  test("trims figures longer than four decimals and keeps shorter ones as written", () => {
    expect(compactSummary("Sent 1.234567890123456789 ETH to 0x1234…abcd")).toBe(
      "Sent 1.2345 ETH to 0x1234…abcd",
    );
    expect(compactSummary("Received 0.5 STRK from 0x9f…12")).toBe("Received 0.5 STRK from 0x9f…12");
    expect(compactSummary("Swapped 1,234.56789 USDC for STRK")).toBe(
      "Swapped 1,234.5678 USDC for STRK",
    );
    expect(compactSummary("Sent 2.5000 ETH")).toBe("Sent 2.5000 ETH");
  });

  test("keeps tiny sub-unit amounts legible instead of rounding them to zero", () => {
    expect(compactSummary("Received 0.00001234 ETH")).toBe("Received 0.00001234 ETH");
  });

  test("never touches hex identifiers or integers", () => {
    const summary =
      "Approve 0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7 for 100 STRK";
    expect(compactSummary(summary)).toBe(summary);
    expect(compactSummary("Claimed staking rewards")).toBe("Claimed staking rewards");
  });
});
