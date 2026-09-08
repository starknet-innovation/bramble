/**
 * The non-reduced-motion branch of `animate()`. Under this repo's strict
 * skipLibCheck the happy-dom global registrator's types cannot join the
 * program, and its Web Animations support is partial anyway, so rather than a
 * real DOM this drives `animate` against a minimal element double exposing just
 * the two WAAPI methods the code touches — `getAnimations()` and `animate()`.
 * `matchMedia` is stubbed to report no reduced-motion preference so the live
 * branch (cancel same-id in-flight animations, start a new one, tag it, return
 * it) runs. Mirrors the helper-focused style of tests/sidepanel/motion.test.ts.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { animate } from "../../../src/sidepanel/shared/motion";

type FakeAnimation = { id: string; readonly cancel: () => void };

// Builds an element double that records which in-flight animations were
// cancelled and captures the keyframes/timing passed to the new animation.
const fakeElement = (
  existing: readonly { id: string }[],
): {
  readonly el: Element;
  readonly cancelled: string[];
  readonly started: { keyframes?: Keyframe[]; timing?: KeyframeAnimationOptions }[];
} => {
  const cancelled: string[] = [];
  const started: { keyframes?: Keyframe[]; timing?: KeyframeAnimationOptions }[] = [];
  const animations: FakeAnimation[] = existing.map((entry) => ({
    id: entry.id,
    cancel: () => {
      cancelled.push(entry.id);
    },
  }));
  const el = {
    getAnimations: () => animations,
    animate: (keyframes: Keyframe[], timing: KeyframeAnimationOptions): FakeAnimation => {
      started.push({ keyframes, timing });
      return { id: "", cancel: () => undefined };
    },
  } as unknown as Element;
  return { cancelled, el, started };
};

const originalMatchMedia = globalThis.matchMedia;

beforeAll(() => {
  // No reduced-motion preference, so animate() takes the live WAAPI path.
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof globalThis.matchMedia;
});

afterAll(() => {
  globalThis.matchMedia = originalMatchMedia;
});

describe("animate (live motion branch)", () => {
  const frames: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

  test("cancels only the same-id in-flight animation, starts a new one, and tags it", () => {
    const { cancelled, el, started } = fakeElement([{ id: "bramble-motion" }, { id: "other" }]);

    const anim = animate(el, frames, { duration: 200 });

    // A live Animation is returned (not the reduced-motion null).
    expect(anim).not.toBeNull();
    // Only the animation sharing the default bramble-motion id is cancelled; the
    // unrelated one is left running.
    expect(cancelled).toEqual(["bramble-motion"]);
    // A new animation was started with the caller's keyframes and the strong
    // ease-out defaults merged with the passed timing.
    expect(started).toHaveLength(1);
    expect(started[0]?.keyframes).toBe(frames);
    expect(started[0]?.timing).toMatchObject({
      duration: 200,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      fill: "both",
    });
    // The returned animation is tagged with the default motion id.
    expect(anim?.id).toBe("bramble-motion");
  });

  test("scopes interruption to a custom id and never cancels foreign ids", () => {
    const { cancelled, el } = fakeElement([{ id: "bramble-motion" }, { id: "drawer" }]);

    const anim = animate(el, frames, { id: "drawer", duration: 120 });

    // With id "drawer" only the drawer animation is cancelled; bramble-motion stays.
    expect(cancelled).toEqual(["drawer"]);
    expect(anim?.id).toBe("drawer");
  });

  test("starts an animation even with no in-flight animations to cancel", () => {
    const { cancelled, el, started } = fakeElement([]);

    const anim = animate(el, frames);

    expect(cancelled).toEqual([]);
    expect(started).toHaveLength(1);
    expect(anim?.id).toBe("bramble-motion");
  });
});
