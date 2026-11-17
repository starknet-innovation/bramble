/**
 * Fixed-UTC formatting of epoch-millisecond timestamps for the side panel.
 *
 * UTC is deliberate: it keeps every label deterministic and avoids the implicit
 * clock and date-construction sources the file-standards gate forbids outside
 * the approved boundary modules — the epoch number is formatted directly, and
 * no "today"/"yesterday" wording is derived because that would need a clock.
 * Day and clock are separate formatters rather than one combined format: a
 * combined format leaves the joiner to the ICU version (", " vs " at "), so a
 * label would vary across Chrome builds and test environments.
 */
import { MAX_ACTIVITY_TIMESTAMP_MS } from "@bramble/transactions/activity";

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

const DAY_WITH_YEAR_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

const CLOCK_FORMAT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  timeZone: "UTC",
});

// Past the ECMAScript Date range every formatter throws, so such a value is
// treated like a missing one rather than breaking the whole screen.
const isTimestamp = (value: number): boolean =>
  Number.isFinite(value) && value > 0 && value <= MAX_ACTIVITY_TIMESTAMP_MS;

/**
 * Calendar day in UTC without the year, e.g. `12 Sep`. Returns null for a
 * missing or non-positive timestamp so callers render nothing rather than a
 * 1970 date.
 */
export const formatUtcDay = (epochMs: number | null): string | null =>
  epochMs !== null && isTimestamp(epochMs) ? DAY_FORMAT.format(epochMs) : null;

/**
 * Calendar day in UTC with the year, e.g. `12 Sep 2026`, for group headings
 * that must stay unambiguous across a long feed. Null on a missing timestamp.
 */
export const formatUtcDate = (epochMs: number | null): string | null =>
  epochMs !== null && isTimestamp(epochMs) ? DAY_WITH_YEAR_FORMAT.format(epochMs) : null;

/**
 * 24-hour wall clock in UTC with the zone spelled out, e.g. `14:32 UTC`. Null
 * on a missing timestamp.
 */
export const formatUtcClock = (epochMs: number | null): string | null =>
  epochMs !== null && isTimestamp(epochMs) ? `${CLOCK_FORMAT.format(epochMs)} UTC` : null;

/**
 * Stable key for grouping timestamps by UTC calendar day: the epoch day
 * number, so two entries share a key exactly when they share a UTC date.
 */
export const utcDayKey = (epochMs: number): number => Math.floor(epochMs / 86_400_000);
