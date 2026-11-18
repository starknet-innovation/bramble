/**
 * Dates and amounts follow the UI language; English output is unchanged.
 */
import { afterEach, expect, test } from "bun:test";
import { setUiLocale } from "../../../src/i18n/locale";
import { formatFiat } from "../../../src/sidepanel/shared/fiat";
import {
  formatUtcClock,
  formatUtcDate,
  formatUtcDay,
} from "../../../src/sidepanel/shared/timestamp";

const SEPT_2 = Date.UTC(2026, 8, 2, 14, 5);

// The en-GB short month is "Sep" or "Sept" depending on the ICU data in the
// runtime, so English is pinned to the exact formatter the panel shipped with
// before localization rather than to a literal.
const releaseEnglish = (options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(SEPT_2);

afterEach(() => setUiLocale("en"));

test("English keeps the padded day-month order", () => {
  expect(formatUtcDay(SEPT_2)).toBe(releaseEnglish({ day: "2-digit", month: "short" }));
  expect(formatUtcDate(SEPT_2)).toBe(
    releaseEnglish({ day: "2-digit", month: "short", year: "numeric" }),
  );
  expect(formatUtcDay(SEPT_2)).toMatch(/^02 Sept?$/u);
  expect(formatUtcClock(SEPT_2)).toBe("14:05 UTC");
});

test("Simplified Chinese uses an unpadded month-day form", () => {
  setUiLocale("zh-Hans");
  expect(formatUtcDay(SEPT_2)).toBe("9月2日");
  expect(formatUtcDate(SEPT_2)).toBe("2026年9月2日");
  expect(formatUtcClock(SEPT_2)).toBe("14:05 UTC");
});

test("fiat grouping reads the same in both languages", () => {
  for (const locale of ["en", "zh-Hans"] as const) {
    setUiLocale(locale);
    expect(formatFiat(1234567.891, "usd")).toBe("$1,234,567.89");
  }
});
