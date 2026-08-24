/**
 * Imperative motion primitives for the side panel, built on the Web Animations
 * API (WAAPI) — hardware-accelerated, interruptible, and dependency-free, so it
 * stays inside the MV3 CSP (no `eval`, no external library).
 *
 * Every helper here is reduced-motion aware: under `prefers-reduced-motion:
 * reduce` motion is skipped and the element is cut straight to its final state
 * (the CSS side of reduced motion is handled in ./styles-home.ts). New
 * imperative motion must go through these helpers so the accessibility contract
 * holds everywhere.
 *
 * By convention only compositor-friendly properties (`transform`, `opacity`)
 * should be animated, and in-flight animations on the same element
 * are cancelled before a new one starts so gestures can retarget mid-flight.
 */
const MOTION_ID = "mc-motion";

/**
 * Reports whether the user has requested reduced motion in the element or
 * document that owns the interaction. This keeps isolated UI Lab frames true
 * to their own motion setting instead of reading the outer Storybook host.
 */
export const prefersReducedMotion = (context: Document | Element | null): boolean => {
  const doc = context ? ("defaultView" in context ? context : context.ownerDocument) : null;
  const view = doc?.defaultView;
  return view?.matchMedia("(prefers-reduced-motion: reduce)").matches ?? false;
};

/**
 * Options for {@link animate}: standard WAAPI timing plus an optional id used to
 * scope interruption (only animations sharing the id are cancelled).
 */
export type MotionOptions = KeyframeAnimationOptions & { readonly id?: string };

// Cuts an element to the final keyframe with no motion. Used for reduced motion.
const cutToFinal = (el: Element, keyframes: Keyframe[]): void => {
  const final = keyframes[keyframes.length - 1];
  if (final) {
    el.animate([final], { duration: 0, fill: "forwards" });
  }
};

/**
 * Interruptible WAAPI animation. Cancels any in-flight mc-motion animation on
 * the element first (so a new gesture retargets instead of colliding), then
 * animates. Under reduced motion it cuts straight to the final keyframe and
 * returns `null`. Defaults to `fill: "both"` and the strong ease-out curve.
 */
export const animate = (
  el: Element,
  keyframes: Keyframe[],
  options: MotionOptions = {},
): Animation | null => {
  if (prefersReducedMotion(el)) {
    cutToFinal(el, keyframes);
    return null;
  }
  const { id = MOTION_ID, ...timing } = options;
  for (const existing of el.getAnimations()) {
    if (existing.id === id) {
      existing.cancel();
    }
  }
  const anim = el.animate(keyframes, {
    easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    fill: "both",
    ...timing,
  }) as Animation | null;
  if (!anim) {
    return null;
  }
  anim.id = id;
  return anim;
};

/**
 * Stagger delays for a group entering together: `count` evenly spaced offsets
 * `step` ms apart from `base`. Keep `step` in the 30–80ms range so the cascade
 * reads as lively without making the interface feel slow.
 */
export const stagger = (count: number, step = 50, base = 0): number[] =>
  Array.from({ length: Math.max(0, count) }, (_, index) => base + index * step);

/**
 * Projects where a flick would come to rest, Apple's exponential-decay momentum
 * model from *Designing Fluid Interfaces* (not the physics-textbook form). Given
 * a release velocity in px/s it returns the extra displacement (px, sign follows
 * the velocity) the gesture would carry, so a drag handler can pick its snap
 * target from where the motion is *going* rather than where the finger left off.
 * `decelerationRate` ≈ 0.998 gives a normal scroll feel; lower is snappier.
 */
export const projectMomentum = (velocity: number, decelerationRate = 0.998): number =>
  ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
