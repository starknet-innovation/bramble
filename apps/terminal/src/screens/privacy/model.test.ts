import { describe, expect, it } from "vitest";
import { formatRaw, parseAmount, short } from "./model";

describe("privacy amount and display model", () => {
  it("parses positive decimal amounts at the token precision", () => {
    expect(parseAmount("1.25", 6)).toBe(1_250_000n);
    expect(parseAmount("0.000001", 6)).toBe(1n);
  });

  it("rejects zero, signs, exponent notation, and excess precision", () => {
    for (const value of ["0", "-1", "+1", "1e2", ".5", "1.0000001"]) {
      expect(() => parseAmount(value, 6)).toThrow();
    }
  });

  it("formats raw balances without floating-point conversion", () => {
    expect(formatRaw("0x12d687", 6)).toBe("1.234567");
    expect(formatRaw("0xf4240", 6)).toBe("1");
    expect(short("0x1234567890abcdef1234567890")).toBe("0x12345678…567890");
  });
});
