/**
 * Theme resolution checks: the stored theme choice maps to the right skin and
 * the CSS `color-scheme` the panel applies to its root — "system" opts into
 * `light dark` so system colors flip with the browser, while pinned choices use
 * the Clean Mono skins under a fixed scheme.
 */
import { describe, expect, test } from "bun:test";

import { darkSkin } from "../src/ui/dark-skin";
import { defaultSkin } from "../src/ui/default-skin";
import { systemSkin } from "../src/ui/system-skin";
import { colorSchemeForChoice, skinForChoice } from "../src/ui/theme";

describe("skinForChoice", () => {
  test("system (the default) resolves to the system skin", () => {
    expect(skinForChoice("system")).toBe(systemSkin);
  });

  test("pinned dark/light resolve to the Clean Mono skins", () => {
    expect(skinForChoice("dark")).toBe(darkSkin);
    expect(skinForChoice("light")).toBe(defaultSkin);
  });
});

describe("colorSchemeForChoice", () => {
  test("system opts into the dual light dark scheme", () => {
    expect(colorSchemeForChoice("system")).toBe("light dark");
  });

  test("pinned choices fix a single scheme so the browser cannot flip them", () => {
    expect(colorSchemeForChoice("dark")).toBe("dark");
    expect(colorSchemeForChoice("light")).toBe("light");
  });
});
