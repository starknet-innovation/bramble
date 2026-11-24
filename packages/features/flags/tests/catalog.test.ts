/**
 * Flags stay off unless someone turns them on: only a feature that already
 * ships may be bundled on, and then the publisher can only kill it, never
 * switch on something new. Every other flag is bundled off, so an expired,
 * missing or unreachable document can never make a feature appear.
 */
import { expect, test } from "bun:test";
import { BUNDLED_FLAGS } from "../src/catalog";

// Features that shipped before their flag existed. Adding one here is the
// deliberate act the policy asks for; a new feature starts bundled off.
const SHIPPED_FEATURES = ["swap.enabled"];

test("only shipped features are bundled on", () => {
  const on = Object.entries(BUNDLED_FLAGS)
    .filter(([, known]) => known.enabled)
    .map(([key]) => key)
    .sort();
  expect(on).toEqual([...SHIPPED_FEATURES].sort());
});

test("a flag bundled on is kill-only", () => {
  for (const [key, known] of Object.entries(BUNDLED_FLAGS)) {
    if (known.enabled) {
      expect({ key, remote: known.remote ?? "kill-only" }).toEqual({ key, remote: "kill-only" });
    }
  }
});
