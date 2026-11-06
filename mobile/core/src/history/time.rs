//! Fixed-UTC timestamps, as the side panel's `shared/timestamp.ts` renders them through
//! `Intl.DateTimeFormat("en-GB", { timeZone: "UTC" })`: `05 Sep`, `05 Sep 2026`, `14:32 UTC`.
//! Also the ISO 8601 subset Starkscan timestamps are read with (`Date.parse` narrowed to formats
//! whose meaning does not depend on the device's time zone).

const DAY_MS: f64 = 86_400_000.0;
/// The largest time value a JavaScript `Date` holds; `Intl` throws past it, mobile prints nothing.
const MAX_TIME_MS: f64 = 8.64e15;
const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Howard Hinnant's civil-from-days: proleptic Gregorian (year, month 1-12, day 1-31).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let m = i64::from(month);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn parts(epoch_ms: Option<f64>) -> Option<(i64, u32, u32, u32, u32)> {
    let ms = epoch_ms
        .filter(|ms| ms.is_finite() && *ms > 0.0 && *ms <= MAX_TIME_MS)?
        .floor();
    let days = (ms / DAY_MS).floor();
    let (year, month, day) = civil_from_days(days as i64);
    let in_day = (ms - days * DAY_MS) as u64;
    Some((
        year,
        month,
        day,
        (in_day / 3_600_000) as u32,
        (in_day / 60_000 % 60) as u32,
    ))
}

/// `formatUtcDay`: `05 Sep`.
pub fn format_utc_day(epoch_ms: Option<f64>) -> Option<String> {
    parts(epoch_ms).map(|(_, m, d, _, _)| format!("{d:02} {}", MONTHS[m as usize - 1]))
}

/// `formatUtcDate`: `05 Sep 2026`.
pub fn format_utc_date(epoch_ms: Option<f64>) -> Option<String> {
    parts(epoch_ms).map(|(y, m, d, _, _)| format!("{d:02} {} {y}", MONTHS[m as usize - 1]))
}

/// `formatUtcClock`: `14:32 UTC`.
pub fn format_utc_clock(epoch_ms: Option<f64>) -> Option<String> {
    parts(epoch_ms).map(|(_, _, _, h, min)| format!("{h:02}:{min:02} UTC"))
}

/// `utcDayKey`.
pub fn utc_day_key(epoch_ms: f64) -> i64 {
    (epoch_ms / DAY_MS).floor() as i64
}

/// `formatSavedDataLabel(label, asOf)`: `prices (05 Sep, 14:32 UTC)`, or the bare label.
pub fn format_saved_data_label(label: &str, as_of: Option<f64>) -> String {
    match (format_utc_day(as_of), format_utc_clock(as_of)) {
        (Some(day), Some(clock)) => format!("{label} ({day}, {clock})"),
        _ => label.to_string(),
    }
}

fn number(text: &str) -> Option<u32> {
    (!text.is_empty() && text.bytes().all(|b| b.is_ascii_digit())).then(|| text.parse().ok())?
}

fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        2 if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// `Date.parse` for `YYYY-MM-DD` (UTC) and `YYYY-MM-DDTHH:mm[:ss[.fff…]](Z|±HH:mm)`; fractions
/// past milliseconds are truncated. A date-time without a zone (local time in JavaScript) and
/// every non-ISO spelling are refused: mobile drops such a row rather than guess a zone.
pub fn parse_iso_timestamp(text: &str) -> Option<f64> {
    let (date, time) = match text.split_once('T') {
        Some((date, time)) => (date, Some(time)),
        None => (text, None),
    };
    let mut fields = date.split('-');
    let (year, month, day) = (fields.next()?, fields.next()?, fields.next()?);
    if fields.next().is_some() || year.len() != 4 || month.len() != 2 || day.len() != 2 {
        return None;
    }
    let (year, month, day) = (i64::from(number(year)?), number(month)?, number(day)?);
    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
        return None;
    }
    let mut ms = days_from_civil(year, month, day) as f64 * DAY_MS;
    if let Some(time) = time {
        let (clock, offset_minutes) = if let Some(clock) = time.strip_suffix('Z') {
            (clock, 0i64)
        } else {
            let at = time.rfind(['+', '-'])?;
            let (clock, zone) = time.split_at(at);
            let (hours, minutes) = zone[1..].split_once(':')?;
            if hours.len() != 2 || minutes.len() != 2 {
                return None;
            }
            let (h, m) = (number(hours)?, number(minutes)?);
            if h > 23 || m > 59 {
                return None;
            }
            let sign = if zone.starts_with('-') { -1 } else { 1 };
            (clock, sign * i64::from(h * 60 + m))
        };
        let (hms, fraction) = match clock.split_once('.') {
            Some((hms, fraction)) => (hms, Some(fraction)),
            None => (clock, None),
        };
        let mut pieces = hms.split(':');
        let hour = pieces.next().filter(|p| p.len() == 2).and_then(number)?;
        let minute = pieces.next().filter(|p| p.len() == 2).and_then(number)?;
        let second = match pieces.next() {
            Some(p) if p.len() == 2 => number(p)?,
            Some(_) => return None,
            None if fraction.is_some() => return None,
            None => 0,
        };
        if pieces.next().is_some() || hour > 23 || minute > 59 || second > 59 {
            return None;
        }
        let millis = match fraction {
            None => 0,
            Some(f) if !f.is_empty() && f.len() <= 9 && f.bytes().all(|b| b.is_ascii_digit()) => {
                format!("{f:0<3}")[..3].parse::<u32>().ok()?
            }
            Some(_) => return None,
        };
        ms += f64::from(hour) * 3_600_000.0
            + f64::from(minute) * 60_000.0
            + f64::from(second) * 1000.0
            + f64::from(millis);
        ms -= offset_minutes as f64 * 60_000.0;
    }
    Some(ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_like_en_gb_utc() {
        let t = 1_788_566_820_000.0; // 2026-09-05T00:07:00Z
        assert_eq!(format_utc_day(Some(t)).as_deref(), Some("05 Sep"));
        assert_eq!(format_utc_date(Some(t)).as_deref(), Some("05 Sep 2026"));
        assert_eq!(format_utc_clock(Some(t)).as_deref(), Some("00:07 UTC"));
        assert_eq!(format_utc_day(Some(0.0)), None);
        assert_eq!(format_saved_data_label("prices", None), "prices");
    }

    #[test]
    fn parses_iso_subset() {
        assert_eq!(
            parse_iso_timestamp("2026-09-05T00:07:00Z"),
            Some(1_788_566_820_000.0)
        );
        assert_eq!(
            parse_iso_timestamp("2026-09-05T02:07:00.5+02:00"),
            Some(1_788_566_820_500.0)
        );
        assert_eq!(parse_iso_timestamp("2026-09-05"), Some(1_788_566_400_000.0));
        for bad in [
            "2026-09-05T00:07:00",
            "Sep 5 2026",
            "2026-02-30",
            "2026-9-05",
            "2026-09-05T24:00Z",
        ] {
            assert_eq!(parse_iso_timestamp(bad), None, "{bad}");
        }
    }
}
