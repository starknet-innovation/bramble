/**
 * Tests for message catalogs: locale matching, typed lookup, and the
 * structural checks every package's catalog test relies on.
 */
import { describe, expect, test } from "bun:test";

import {
  catalogFailures,
  formatMessage,
  isLocale,
  localeForLanguages,
  placeholderNames,
  translator,
} from "@bramble/core/i18n";

describe("localeForLanguages", () => {
  test("serves Simplified Chinese to Simplified and bare zh tags", () => {
    for (const tag of ["zh", "zh-CN", "zh-SG", "zh-Hans", "zh-Hans-CN", "ZH-cn"]) {
      expect(localeForLanguages([tag])).toBe("zh-Hans");
    }
  });

  test("skips Traditional Chinese instead of answering it in Simplified", () => {
    for (const tag of ["zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-Hant-TW"]) {
      expect(localeForLanguages([tag])).toBe("en");
    }
    expect(localeForLanguages(["zh-TW", "zh-CN"])).toBe("zh-Hans");
  });

  test("takes the first supported tag in the browser's order", () => {
    expect(localeForLanguages(["fr-FR", "en-US", "zh-CN"])).toBe("en");
    expect(localeForLanguages(["fr-FR", "zh-CN", "en-US"])).toBe("zh-Hans");
  });

  test("falls back to English", () => {
    expect(localeForLanguages([])).toBe("en");
    expect(localeForLanguages(["fr-FR", "ja"])).toBe("en");
    expect(localeForLanguages(["english", "zhx"])).toBe("en");
  });
});

test("isLocale accepts exactly the shipped tags", () => {
  expect(isLocale("en")).toBe(true);
  expect(isLocale("zh-Hans")).toBe(true);
  for (const value of ["zh", "zh-CN", "EN", "", null, 1]) expect(isLocale(value)).toBe(false);
});

describe("formatMessage", () => {
  test("fills every placeholder occurrence", () => {
    expect(
      formatMessage("Send {amount} {symbol}, {amount}", { amount: "1.5", symbol: "STRK" }),
    ).toBe("Send 1.5 STRK, 1.5");
  });

  test("inserts values verbatim, never re-reading them as templates", () => {
    expect(formatMessage("To {name}", { name: "{amount} <b>" })).toBe("To {amount} <b>");
  });

  test("throws rather than drop a missing fact", () => {
    expect(() => formatMessage("Send {amount}", {})).toThrow("missing message parameter: amount");
  });
});

test("placeholderNames lists distinct names in order", () => {
  expect(placeholderNames("{b} and {a} and {b}")).toEqual(["a", "b"]);
  expect(placeholderNames("no facts, {} or {1x}")).toEqual([]);
});

describe("translator", () => {
  const en = { greet: "Hello {name}", plain: "Done" } as const;
  const t = translator({ en, "zh-Hans": { greet: "你好，{name}", plain: "完成" } });

  test("looks up the bound locale", () => {
    expect(t("en")("greet", { name: "Ada" })).toBe("Hello Ada");
    expect(t("zh-Hans")("greet", { name: "Ada" })).toBe("你好，Ada");
    expect(t("zh-Hans")("plain")).toBe("完成");
  });
});

describe("catalogFailures", () => {
  test("passes a complete, matching catalog set", () => {
    expect(catalogFailures({ en: { a: "Send {x}" }, "zh-Hans": { a: "发送 {x}" } })).toEqual([]);
  });

  test("reports missing, unknown, mismatched, markup and padded entries", () => {
    expect(
      catalogFailures({
        en: { a: "Send {amount}", b: "Done", c: "Ok" },
        "zh-Hans": { a: "发送 {amout}", c: "<b>好</b>", d: "多余", b: " 完成" },
      }),
    ).toEqual([
      "zh-Hans: a placeholders differ from en",
      "zh-Hans: c contains markup",
      "zh-Hans: unknown d",
      "zh-Hans: b is empty or padded",
    ]);
  });

  test("reports an English key absent from a translation", () => {
    expect(catalogFailures({ en: { a: "A", b: "B" }, "zh-Hans": { a: "甲" } })).toEqual([
      "zh-Hans: missing b",
    ]);
  });
});
