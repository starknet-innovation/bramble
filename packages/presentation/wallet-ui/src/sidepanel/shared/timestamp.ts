/**
 * Fixed-UTC formatting of epoch-millisecond timestamps for the side panel, in
 * the active UI language.
 *
 * UTC is deliberate: it keeps every label deterministic and avoids the implicit
 * clock and date-construction sources the file-standards gate forbids outside
 * the approved boundary modules — the epoch number is formatted directly, and
 * no "today"/"yesterday" wording is derived because that would need a clock.
 * Day and clock are separate formatters rather than one combined format: a
 * combined format leaves the joiner to the ICU version (", " vs " at "), so a
 * label would vary across Chrome builds and test environments.
 */
import type { Locale } from "@bramble/core/i18n";
import { MAX_ACTIVITY_TIMESTAMP_MS } from "@bramble/transactions/activity";
import { uiLocale } from "../../i18n/locale";

// English keeps the en-GB day-month order the panel has always shown; Chinese
// takes a numeric day ("9月2日"), since a padded one reads as a typo there.
const DATE_LOCALE: Readonly<Record<Locale, string>> = { en: "en-GB", "zh-Hans": "zh-Hans" };
const DAY_DIGITS: Readonly<Record<Locale, "2-digit" | "numeric">> = {
  en: "2-digit",
  "zh-Hans": "numeric",
};

type FormatKind = "clock" | "day" | "date";

const formatOptions = (kind: FormatKind, locale: Locale): Intl.DateTimeFormatOptions =>
  kind === "clock"
    ? { hour: "2-digit", hour12: false, minute: "2-digit", timeZone: "UTC" }
    : {
        day: DAY_DIGITS[locale],
        month: "short",
        timeZone: "UTC",
        ...(kind === "date" ? { year: "numeric" } : {}),
      };

// One formatter per locale and kind; building them is the expensive part.
const formatters = new Map<string, Intl.DateTimeFormat>();
const formatter = (kind: FormatKind): Intl.DateTimeFormat => {
  const locale = uiLocale();
  const key = `${locale}:${kind}`;
  const cached = formatters.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(DATE_LOCALE[locale], formatOptions(kind, locale));
  formatters.set(key, created);
  return created;
};

// Past the ECMAScript Date range every formatter throws, so such a value is
// treated like a missing one rather than breaking the whole screen.
const isTimestamp = (value: number): boolean =>
  Number.isFinite(value) && value > 0 && value <= MAX_ACTIVITY_TIMESTAMP_MS;

/**
 * Calendar day in UTC without the year, e.g. `12 Sep` or `9月12日`. Returns null for a
 * missing or non-positive timestamp so callers render nothing rather than a
 * 1970 date.
 */
export const formatUtcDay = (epochMs: number | null): string | null =>
  epochMs !== null && isTimestamp(epochMs) ? formatter("day").format(epochMs) : null;

/**
 * Calendar day in UTC with the year, e.g. `12 Sep 2026` or `2026年9月12日`, for group headings
 * that must stay unambiguous across a long feed. Null on a missing timestamp.
 */
export const formatUtcDate = (epochMs: number | null): string | null =>
  epochMs !== null && isTimestamp(epochMs) ? formatter("date").format(epochMs) : null;

/**
 * 24-hour wall clock in UTC with the zone spelled out, e.g. `14:32 UTC`. Null
 * on a missing timestamp.
 */
export const formatUtcClock = (epochMs: number | null): string | null =>
  epochMs !== null && isTimestamp(epochMs) ? `${formatter("clock").format(epochMs)} UTC` : null;

/**
 * Stable key for grouping timestamps by UTC calendar day: the epoch day
 * number, so two entries share a key exactly when they share a UTC date.
 */
export const utcDayKey = (epochMs: number): number => Math.floor(epochMs / 86_400_000);
