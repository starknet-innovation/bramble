/**
 * The wallet UI catalog: every locale covers every key with the same facts,
 * lookup follows the active locale, and the HTML variant escapes.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { catalogFailures } from "@bramble/core/i18n";
import { resolveUiLocale, setUiLocale, uiLocale } from "../../src/i18n/locale";
import { LANGUAGE_NAMES, t, th, uiCatalogs } from "../../src/i18n/messages";

afterEach(() => setUiLocale("en"));

test("every locale covers every UI message with matching placeholders and no markup", () => {
  expect(catalogFailures(uiCatalogs)).toEqual([]);
});

test("lookup follows the active locale", () => {
  expect(uiLocale()).toBe("en");
  expect(t("settings.language.title")).toBe("Language");
  setUiLocale("zh-Hans");
  expect(t("settings.language.title")).toBe("语言");
});

test("th escapes the message for string-HTML templates", () => {
  expect(th("settings.language.saveFailed")).toBe("Couldn&#39;t change the language.");
});

test("language names stay in their own script whatever the UI language", () => {
  setUiLocale("zh-Hans");
  expect(LANGUAGE_NAMES).toEqual({ en: "English", "zh-Hans": "简体中文" });
});

describe("resolveUiLocale", () => {
  test("follows the browser when unset or auto", () => {
    expect(resolveUiLocale(undefined, ["zh-CN", "en"])).toBe("zh-Hans");
    expect(resolveUiLocale("auto", ["zh-CN"])).toBe("zh-Hans");
    expect(resolveUiLocale("auto", ["zh-TW"])).toBe("en");
    expect(resolveUiLocale(undefined, [])).toBe("en");
  });

  test("a pinned language wins over the browser", () => {
    expect(resolveUiLocale("en", ["zh-CN"])).toBe("en");
    expect(resolveUiLocale("zh-Hans", ["en-US"])).toBe("zh-Hans");
  });
});
