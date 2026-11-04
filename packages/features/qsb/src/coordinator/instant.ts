/**
 * UTC instants as the QSB coordinator writes them: ISO 8601 with
 * milliseconds and a `Z`, e.g. `2026-11-04T12:05:00.000Z` (JavaScript's
 * `toISOString`). Pure calendar arithmetic over epoch milliseconds, so a
 * caller's injected clock is the only time source; nothing here reads one.
 */

const MS_PER_DAY = 86_400_000;
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/;

const pad = (value: number, width: number): string => String(value).padStart(width, "0");

// Days since 1970-01-01 of a proleptic Gregorian date (H. Hinnant's algorithm).
const daysFromCivil = (year: number, month: number, day: number): number => {
  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
};

// The date of a day count, the inverse of daysFromCivil.
const civilFromDays = (days: number): readonly [number, number, number] => {
  const shifted = days + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1_460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex + (monthIndex < 10 ? 3 : -9);
  return [yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day];
};

/**
 * Formats epoch milliseconds as `YYYY-MM-DDTHH:MM:SS.mmmZ`. Throws for a
 * value outside years 0000–9999 or that is not an integer, so a broken clock
 * never produces a timestamp the coordinator would parse differently.
 */
export const isoInstant = (epochMs: number): string => {
  if (!Number.isSafeInteger(epochMs)) {
    throw new RangeError("QSB instant is not an integer");
  }
  const days = Math.floor(epochMs / MS_PER_DAY);
  const [year, month, day] = civilFromDays(days);
  if (year < 0 || year > 9_999) {
    throw new RangeError("QSB instant is out of range");
  }
  const inDay = epochMs - days * MS_PER_DAY;
  const time = [
    pad(Math.floor(inDay / 3_600_000), 2),
    pad(Math.floor(inDay / 60_000) % 60, 2),
    pad(Math.floor(inDay / 1_000) % 60, 2),
  ].join(":");
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${time}.${pad(inDay % 1_000, 3)}Z`;
};

/**
 * Parses exactly that form (milliseconds optional) into epoch milliseconds;
 * null for any other spelling or an impossible date or time, such as
 * February 30th or 24:00. No offsets, no lenient parsing.
 */
export const parseIsoInstant = (text: string): number | null => {
  const match = INSTANT.exec(text);
  if (!match) {
    return null;
  }
  const [year, month, day, hour, minute, second, millis] = match
    .slice(1)
    .map((part) => Number(part ?? "0"));
  const ms =
    daysFromCivil(year ?? 0, month ?? 0, day ?? 0) * MS_PER_DAY +
    (hour ?? 0) * 3_600_000 +
    (minute ?? 0) * 60_000 +
    (second ?? 0) * 1_000 +
    (millis ?? 0);
  // Out-of-range fields (month 13, day 31 of a 30-day month, hour 24) round
  // trip to another spelling, so only the canonical one is a valid instant.
  try {
    return isoInstant(ms).slice(0, 19) === text.slice(0, 19) ? ms : null;
  } catch {
    return null;
  }
};
