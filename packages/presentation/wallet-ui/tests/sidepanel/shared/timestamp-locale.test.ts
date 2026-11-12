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

afterEach(() => setUiLocale("en"));

test("English keeps the padded day-month order", () => {
  expect(formatUtcDay(SEPT_2)).toBe("02 Sep");
  expect(formatUtcDate(SEPT_2)).toBe("02 Sep 2026");
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
