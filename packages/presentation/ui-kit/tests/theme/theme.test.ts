/**
 * Theme resolution checks: the stored theme choice maps to the right pinned
 * skin and the CSS `color-scheme` the panel applies to its root. The former
 * "system" theme was removed (system-color neutrals broke the designed surface
 * tiers and failed contrast); a legacy stored "system" value must keep
 * resolving — to the default dark skin — so old installs never break.
 */
import { describe, expect, test } from "bun:test";

import { darkSkin } from "@bramble/ui-kit/dark-skin";
import { defaultSkin } from "@bramble/ui-kit/default-skin";
import { colorSchemeForChoice, skinForChoice } from "@bramble/ui-kit/theme";

describe("skinForChoice", () => {
  test("dark/light resolve to the Clean Mono skins", () => {
    expect(skinForChoice("dark")).toBe(darkSkin);
    expect(skinForChoice("light")).toBe(defaultSkin);
  });

  test("the legacy stored system value resolves to the default dark skin", () => {
    expect(skinForChoice("system")).toBe(darkSkin);
  });
});

describe("colorSchemeForChoice", () => {
  test("every choice pins a single scheme so the browser cannot flip it", () => {
    expect(colorSchemeForChoice("dark")).toBe("dark");
    expect(colorSchemeForChoice("light")).toBe("light");
    expect(colorSchemeForChoice("system")).toBe("dark");
  });
});
