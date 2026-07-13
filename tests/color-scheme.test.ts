/**
 * Browser color-scheme detection checks: the "system" theme resolves light vs
 * dark from `prefers-color-scheme`, falls back to dark when detection is
 * unavailable, and re-notifies live when the browser flips scheme.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { systemPrefersDark, watchSystemScheme } from "../src/ui/color-scheme";

type Listener = () => void;

type StubQuery = {
  readonly matches: boolean;
  listener: Listener | null;
};

const originalMatchMedia = (globalThis as { matchMedia?: unknown }).matchMedia;

// Installs a matchMedia stub answering both scheme queries and capturing the
// change listener registered against the dark query, so tests can drive flips.
const installMatchMedia = (prefersLight: boolean): { emit: () => void } => {
  const dark: StubQuery = { listener: null, matches: !prefersLight };
  const light: StubQuery = { listener: null, matches: prefersLight };
  (globalThis as { matchMedia?: unknown }).matchMedia = (media: string) => {
    const query = media.includes("light") ? light : dark;
    return {
      matches: query.matches,
      addEventListener: (_type: string, listener: Listener) => {
        query.listener = listener;
      },
      removeEventListener: (_type: string, listener: Listener) => {
        if (query.listener === listener) {
          query.listener = null;
        }
      },
    };
  };
  return {
    emit: () => dark.listener?.(),
  };
};

afterEach(() => {
  (globalThis as { matchMedia?: unknown }).matchMedia = originalMatchMedia;
});

describe("systemPrefersDark", () => {
  test("falls back to dark when matchMedia is unavailable", () => {
    (globalThis as { matchMedia?: unknown }).matchMedia = undefined;
    expect(systemPrefersDark()).toBe(true);
  });

  test("returns false only when the browser explicitly prefers light", () => {
    installMatchMedia(true);
    expect(systemPrefersDark()).toBe(false);
  });

  test("returns true when the browser prefers dark", () => {
    installMatchMedia(false);
    expect(systemPrefersDark()).toBe(true);
  });
});

describe("watchSystemScheme", () => {
  test("invokes the callback on scheme change and stops after unsubscribe", () => {
    const media = installMatchMedia(false);
    let changes = 0;
    const unsubscribe = watchSystemScheme(() => {
      changes += 1;
    });

    media.emit();
    expect(changes).toBe(1);

    unsubscribe();
    media.emit();
    expect(changes).toBe(1);
  });

  test("returns a no-op unsubscribe when matchMedia is unavailable", () => {
    (globalThis as { matchMedia?: unknown }).matchMedia = undefined;
    expect(() => watchSystemScheme(() => undefined)()).not.toThrow();
  });
});
