/**
 * Sparkline geometry checks: scaling, y-inversion, flat series, and trend.
 */
import { describe, expect, test } from "bun:test";
import { sparklinePath, sparklinePoints, sparklineTrend } from "../../src/sidepanel/sparkline";

describe("sparklinePath", () => {
  test("returns empty for fewer than two finite samples or a zero viewBox", () => {
    expect(sparklinePath([], 100, 32)).toBe("");
    expect(sparklinePath([5], 100, 32)).toBe("");
    expect(sparklinePath([1, 2], 0, 32)).toBe("");
    expect(sparklinePath([1, 2], 100, 0)).toBe("");
  });

  test("scales the first sample to x=0 and the last to x=width, inverting y", () => {
    expect(sparklinePath([0, 10], 100, 32)).toBe("0,32 100,0");
    expect(sparklinePath([0, 1, 2], 100, 32)).toBe("0,32 50,16 100,0");
  });

  test("centres a flat series vertically", () => {
    expect(sparklinePath([5, 5, 5], 100, 32)).toBe("0,16 50,16 100,16");
  });

  test("drops non-finite samples before scaling", () => {
    expect(sparklinePath([Number.NaN, 0, 10], 100, 32)).toBe("0,32 100,0");
  });
});

describe("sparklinePoints", () => {
  test("higher values map to smaller y (top of the box)", () => {
    const points = sparklinePoints([1, 9], 10, 20);
    expect(points[0]).toEqual({ x: 0, y: 20 });
    expect(points[1]).toEqual({ x: 10, y: 0 });
  });
});

describe("sparklineTrend", () => {
  test("compares the first and last finite samples", () => {
    expect(sparklineTrend([1, 2])).toBe("up");
    expect(sparklineTrend([2, 1])).toBe("down");
    expect(sparklineTrend([1, 1])).toBe("flat");
    expect(sparklineTrend([])).toBe("flat");
  });
});
