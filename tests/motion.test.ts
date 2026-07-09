/**
 * Motion foundation checks: the pure spring solver produces valid native
 * `linear()` easings, and the imperative helpers respect reduced motion and
 * stagger correctly.
 */
import { describe, expect, test } from "bun:test";
import { prefersReducedMotion, projectMomentum, stagger } from "../src/sidepanel/motion";
import { resolveSpring, solveSpring } from "../src/ui/spring";
import { SPRING } from "../src/ui/tokens";

describe("spring solver", () => {
  test("resolves every named preset to a linear() easing and a bounded duration", () => {
    for (const name of Object.keys(SPRING) as (keyof typeof SPRING)[]) {
      const { easing, durationMs } = resolveSpring(name);
      expect(easing.startsWith("linear(")).toBe(true);
      expect(easing.endsWith(")")).toBe(true);
      expect(durationMs).toBeGreaterThanOrEqual(120);
      expect(durationMs).toBeLessThanOrEqual(1200);
    }
  });

  test("progress starts at 0 and settles at 1", () => {
    const { easing } = solveSpring(SPRING.default);
    const points = easing
      .slice("linear(".length, -1)
      .split(",")
      .map((value) => Number(value.trim()));
    const last = points[points.length - 1] ?? 0;
    expect(points[0]).toBe(0);
    expect(last).toBeGreaterThan(0.99);
    expect(last).toBeLessThanOrEqual(1.0001);
  });

  test("critically damped springs never overshoot; bouncy springs do", () => {
    const critical = solveSpring(SPRING.default)
      .easing.slice("linear(".length, -1)
      .split(",")
      .map((value) => Number(value.trim()));
    expect(Math.max(...critical)).toBeLessThanOrEqual(1.0001);

    const bouncy = solveSpring(SPRING.drawer)
      .easing.slice("linear(".length, -1)
      .split(",")
      .map((value) => Number(value.trim()));
    expect(Math.max(...bouncy)).toBeGreaterThan(1);
  });
});

describe("motion helpers", () => {
  test("stagger returns evenly spaced delays and handles empty groups", () => {
    expect(stagger(3, 50)).toEqual([0, 50, 100]);
    expect(stagger(3, 40, 20)).toEqual([20, 60, 100]);
    expect(stagger(0)).toEqual([]);
  });

  test("prefersReducedMotion is false when matchMedia is unavailable", () => {
    // The test environment has no DOM, so the guard should report no preference
    // rather than throwing on the missing global.
    expect(prefersReducedMotion()).toBe(false);
  });

  test("projectMomentum carries a flick forward in the velocity's direction", () => {
    // Zero velocity lands where the finger left off; the projection grows with
    // speed and mirrors sign, so a leftward flick projects a negative offset.
    expect(projectMomentum(0)).toBe(0);
    expect(projectMomentum(-800)).toBeLessThan(0);
    expect(projectMomentum(800)).toBeGreaterThan(0);
    expect(Math.abs(projectMomentum(1600))).toBeGreaterThan(Math.abs(projectMomentum(400)));
    // A snappier deceleration rate travels less distance for the same velocity.
    expect(projectMomentum(800, 0.99)).toBeLessThan(projectMomentum(800, 0.998));
  });
});
