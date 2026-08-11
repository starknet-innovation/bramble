import { describe, expect, it } from "vitest";
import { isMissingAvnuCandleHistory } from "./avnu-proxy";

describe("AVNU market proxy", () => {
  it("normalizes only missing or failed candle history", () => {
    const candle = "/v3/tokens/0x1/prices/candle?resolution=15";
    expect(isMissingAvnuCandleHistory(candle, 404)).toBe(true);
    expect(isMissingAvnuCandleHistory(candle, 500)).toBe(true);
    expect(isMissingAvnuCandleHistory(candle, 429)).toBe(false);
    expect(isMissingAvnuCandleHistory("/v3/tokens", 500)).toBe(false);
  });
});
