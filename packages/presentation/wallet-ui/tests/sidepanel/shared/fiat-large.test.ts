/**
 * Guards formatFiat against exponential notation at very large magnitudes
 * (>=1e21), where toFixed(2) would otherwise emit a garbled "$1e+21.00" (A-L7).
 */
import { describe, expect, test } from "bun:test";
import { formatFiat } from "../../../src/sidepanel/shared/fiat";

describe("formatFiat large magnitudes", () => {
  test("renders 1e21 as grouped digits without exponential notation", () => {
    const out = formatFiat(1e21, "usd");
    expect(out.startsWith("$")).toBe(true);
    expect(out.toLowerCase()).not.toContain("e");
    expect(out).toContain(",");
    expect(out.endsWith(".00")).toBe(true);
  });

  test("still formats ordinary amounts unchanged", () => {
    expect(formatFiat(1234.5, "usd")).toBe("$1,234.50");
    expect(formatFiat(1000000, "usd")).toBe("$1,000,000.00");
  });
});
