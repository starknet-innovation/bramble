/**
 * Pure spring solver that turns a designer-friendly spring preset
 * (response/damping, see ../ui/tokens.ts `SPRING`) into a native CSS/WAAPI
 * `linear()` easing string plus a settle duration.
 *
 * Springs are sampled analytically (no per-frame physics loop, no dependency)
 * so the same curve can drive both imperative Web Animations (./sidepanel
 * motion helpers) and declarative CSS custom properties. `linear()` is a
 * native easing function — no `eval`, no runtime code compilation — so this is
 * CSP-safe for the MV3 side panel.
 */
import { SPRING, type SpringName, type SpringSpec } from "./tokens";

const TWO_PI = Math.PI * 2;
// Envelope threshold: motion is considered settled once the displacement decays
// below this fraction of the travel. Small enough to be imperceptible.
const SETTLE_THRESHOLD = 0.005;
const MAX_DURATION_MS = 1200;
const MIN_DURATION_MS = 120;

/**
 * Normalized spring displacement from 1 (start) settling toward 0 (target) at
 * time `t` seconds, for natural frequency `omega` and damping ratio `zeta`.
 * Handles the critically damped and under-damped cases (the only ratios the
 * presets use); over-damped falls back to the critical form.
 */
const displacement = (t: number, omega: number, zeta: number): number => {
  if (zeta < 1) {
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    const envelope = Math.exp(-zeta * omega * t);
    return envelope * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
  }
  const envelope = Math.exp(-omega * t);
  return envelope * (1 + omega * t);
};

/**
 * Resolves a spring spec to a WAAPI/CSS `linear()` easing string and a settle
 * duration in milliseconds. Progress runs 0→1 and may briefly exceed 1 when the
 * spring overshoots (bounce), which `linear()` reproduces faithfully.
 */
export const solveSpring = (
  spec: SpringSpec,
  samples = 40,
): { readonly easing: string; readonly durationMs: number } => {
  const omega = TWO_PI / spec.response;
  const zeta = spec.damping;
  // Numerically find the settle time: last moment the envelope is still visible.
  const step = spec.response / 40;
  let settle = step;
  for (let t = step; t <= MAX_DURATION_MS / 1000; t += step) {
    if (Math.abs(displacement(t, omega, zeta)) > SETTLE_THRESHOLD) {
      settle = t;
    }
  }
  const durationMs = Math.min(
    MAX_DURATION_MS,
    Math.max(MIN_DURATION_MS, Math.round(settle * 1000)),
  );
  const durationSec = durationMs / 1000;
  const points: string[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = (durationSec * i) / samples;
    const progress = 1 - displacement(t, omega, zeta);
    points.push(Number(progress.toFixed(4)).toString());
  }
  return { durationMs, easing: `linear(${points.join(", ")})` };
};

/**
 * Resolves a named spring preset to its `linear()` easing and settle duration.
 */
export const resolveSpring = (
  name: SpringName,
): { readonly easing: string; readonly durationMs: number } => solveSpring(SPRING[name]);
