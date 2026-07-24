/**
 * Animates values that changed across the side panel's full-shell repaint.
 */
import { animate } from "./motion";

/**
 * Semantic live-value keys and their pre-repaint values.
 */
export type LiveValueSnapshot = ReadonlyMap<string, string>;

/**
 * Captures semantic live-value keys before a repaint.
 */
export const captureLiveValues = (root: Element | null): LiveValueSnapshot =>
  new Map(
    Array.from(root?.querySelectorAll<HTMLElement>("[data-live-key]") ?? []).flatMap((element) => {
      const key = element.dataset["liveKey"];
      const value = element.dataset["liveValue"];
      return key === undefined || value === undefined ? [] : [[key, value] as const];
    }),
  );

/**
 * Animates only values whose semantic data changed, respecting reduced motion
 * through the shared motion primitive.
 */
export const animateLiveValueChanges = (
  root: Element | null,
  previous: LiveValueSnapshot,
): void => {
  root?.querySelectorAll<HTMLElement>("[data-live-key]").forEach((element) => {
    const key = element.dataset["liveKey"];
    const value = element.dataset["liveValue"];
    const prior = key === undefined ? undefined : previous.get(key);
    if (prior === undefined || value === undefined || prior === value) {
      return;
    }
    animate(
      element,
      [
        { filter: "blur(2px)", opacity: 0.45, transform: "translateY(-3px)" },
        { filter: "blur(0)", opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 320, id: "live-value-change" },
    );
  });
};
