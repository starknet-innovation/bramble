//! JavaScript string and number semantics the extension's display output depends on: `trim`,
//! UTF-16 lengths and slices, `Number(string)`, `Number.prototype.toString`, `toFixed`,
//! `toLocaleString("en-US", { 2 fraction digits })` and `Math.round`. Each one is pinned by the
//! parity fixture the extension's own code writes, because Rust's defaults differ from all of them.

/// JavaScript `WhiteSpace` and `LineTerminator`, the set `String.prototype.trim` removes.
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{9}'..='\u{d}'
            | ' '
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

/// `String.prototype.trim`.
pub fn js_trim(value: &str) -> &str {
    value.trim_matches(is_js_whitespace)
}

/// `string.length`: UTF-16 code units.
pub fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

/// `string.slice(start, end)` over UTF-16 code units, with an end past the string clamped.
pub fn utf16_slice(value: &str, start: usize, end: usize) -> String {
    let units: Vec<u16> = value.encode_utf16().collect();
    let end = end.min(units.len());
    let start = start.min(end);
    String::from_utf16_lossy(&units[start..end])
}

/// `Number(value)` for a string (`StringToNumber`): NaN for anything outside the grammar.
pub fn string_to_number(value: &str) -> f64 {
    let text = js_trim(value);
    if text.is_empty() {
        return 0.0;
    }
    if let Some(parsed) = super::big::parse_bigint(text).filter(|_| {
        let b = text.as_bytes();
        b.len() > 2 && b[0] == b'0' && matches!(b[1], b'x' | b'X' | b'o' | b'O' | b'b' | b'B')
    }) {
        return parsed
            .magnitude
            .to_decimal()
            .parse::<f64>()
            .unwrap_or(f64::NAN);
    }
    let (sign, body) = match text.as_bytes()[0] {
        b'-' => (-1.0, &text[1..]),
        b'+' => (1.0, &text[1..]),
        _ => (1.0, text),
    };
    if body == "Infinity" {
        return sign * f64::INFINITY;
    }
    if !is_decimal_literal(body) {
        return f64::NAN;
    }
    body.parse::<f64>().map_or(f64::NAN, |v| sign * v)
}

// StrUnsignedDecimalLiteral without `Infinity`: digits with an optional fraction, or a fraction
// alone, then an optional exponent.
fn is_decimal_literal(body: &str) -> bool {
    let b = body.as_bytes();
    let mut i = 0;
    let int_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    let int_digits = i - int_start;
    let mut frac_digits = 0;
    if i < b.len() && b[i] == b'.' {
        i += 1;
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        frac_digits = i - start;
    }
    if int_digits + frac_digits == 0 {
        return false;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
            i += 1;
        }
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == start {
            return false;
        }
    }
    i == b.len()
}

/// Shortest round-trip decimal digits of a finite positive value and its exponent `n`, so the
/// value is `0.d1d2…dk × 10^n` (ECMAScript `Number::toString` notation).
fn shortest(value: f64) -> (Vec<u8>, i32) {
    let text = format!("{value:e}");
    let (mantissa, exponent) = text.split_once('e').expect("{:e} has an exponent");
    let exponent: i32 = exponent.parse().expect("{:e} exponent is an integer");
    let digits: Vec<u8> = mantissa.bytes().filter(u8::is_ascii_digit).collect();
    (digits, exponent + 1)
}

/// `Number.prototype.toString()` / `String(number)`.
pub fn number_to_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".into();
    }
    if value == 0.0 {
        return "0".into();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    let (digits, n) = shortest(value.abs());
    let k = digits.len() as i32;
    let d = |range: std::ops::Range<usize>| String::from_utf8_lossy(&digits[range]).into_owned();
    let body = if k <= n && n <= 21 {
        format!("{}{}", d(0..digits.len()), "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", d(0..n as usize), d(n as usize..digits.len()))
    } else if -6 < n && n <= 0 {
        format!("0.{}{}", "0".repeat((-n) as usize), d(0..digits.len()))
    } else {
        let e = n - 1;
        let exp = format!("e{}{}", if e < 0 { "-" } else { "+" }, e.abs());
        if k == 1 {
            format!("{}{exp}", d(0..1))
        } else {
            format!("{}.{}{exp}", d(0..1), d(1..digits.len()))
        }
    };
    format!("{sign}{body}")
}

// Rounds a decimal digit string (integer part `int`, fraction `frac`) half-up to `places`
// fraction digits, returning the new integer and fraction digit strings.
fn round_half_up(int: &str, frac: &str, places: usize) -> (String, String) {
    let mut digits: Vec<u8> = int.bytes().chain(frac.bytes()).collect();
    let keep = int.len() + places;
    while digits.len() < keep {
        digits.push(b'0');
    }
    let round_up = digits.get(keep).is_some_and(|d| *d >= b'5');
    digits.truncate(keep);
    if round_up {
        let mut i = keep;
        loop {
            if i == 0 {
                digits.insert(0, b'1');
                break;
            }
            i -= 1;
            if digits[i] == b'9' {
                digits[i] = b'0';
            } else {
                digits[i] += 1;
                break;
            }
        }
    }
    let split = digits.len() - places;
    let int = String::from_utf8_lossy(&digits[..split]).into_owned();
    let frac = String::from_utf8_lossy(&digits[split..]).into_owned();
    (if int.is_empty() { "0".into() } else { int }, frac)
}

/// `Number.prototype.toFixed(places)`: the exact binary value rounded half up on its magnitude;
/// values at or above 1e21 fall back to `toString`, as the specification requires.
pub fn to_fixed(value: f64, places: usize) -> String {
    if !value.is_finite() {
        return number_to_string(value);
    }
    if value.abs() >= 1e21 {
        return number_to_string(value);
    }
    // Rust's `{:.N}` prints the exact binary expansion when N covers every fraction digit (at
    // most 1074 for an f64), so no rounding happens here; the half-up step below is JavaScript's.
    let exact = format!("{:.1100}", value.abs());
    let (int, frac) = exact.split_once('.').unwrap_or((&exact, ""));
    let (int, frac) = round_half_up(int, frac, places);
    let sign = if value < 0.0 { "-" } else { "" };
    if places == 0 {
        format!("{sign}{int}")
    } else {
        format!("{sign}{int}.{frac}")
    }
}

/// `value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2,
/// useGrouping: true })` for a finite non-negative value. ICU takes the shortest round-trip
/// decimal first and rounds that half-expand, so 1.005 formats as 1.01 (unlike `toFixed`).
pub fn locale_grouped_2(value: f64) -> String {
    let (int, frac) = if value == 0.0 {
        ("0".to_string(), String::new())
    } else {
        let (digits, n) = shortest(value);
        let text = String::from_utf8_lossy(&digits).into_owned();
        if n <= 0 {
            ("0".into(), format!("{}{text}", "0".repeat((-n) as usize)))
        } else if n as usize >= text.len() {
            (
                format!("{text}{}", "0".repeat(n as usize - text.len())),
                String::new(),
            )
        } else {
            (
                text[..n as usize].to_string(),
                text[n as usize..].to_string(),
            )
        }
    };
    let (int, frac) = round_half_up(&int, &frac, 2);
    format!("{}.{frac}", group_digits(&int))
}

fn group_digits(int: &str) -> String {
    let mut out = String::new();
    for (i, c) in int.chars().enumerate() {
        if i > 0 && (int.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// `Math.round`: nearest integer, ties toward +Infinity.
pub fn math_round(value: f64) -> f64 {
    if !value.is_finite() {
        return value;
    }
    let floor = value.floor();
    let rounded = if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    };
    // Math.round keeps the sign of a zero result from a negative input (-0); callers print
    // through number_to_string, which renders -0 as "0" exactly as JavaScript does.
    if rounded == 0.0 && value < 0.0 {
        -0.0
    } else {
        rounded
    }
}

/// `Number.isSafeInteger`.
pub fn is_safe_integer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_991.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_to_string_matches_javascript() {
        let cases = [
            (0.1 + 0.2, "0.30000000000000004"),
            (1e21, "1e+21"),
            (123.45, "123.45"),
            (5e-7, "5e-7"),
            (0.000001, "0.000001"),
            (-0.0, "0"),
            (1.5e300, "1.5e+300"),
            (100.0, "100"),
        ];
        for (value, expected) in cases {
            assert_eq!(number_to_string(value), expected);
        }
    }

    #[test]
    fn fixed_and_locale_round_differently() {
        assert_eq!(to_fixed(1.005, 2), "1.00");
        assert_eq!(locale_grouped_2(1.005), "1.01");
        assert_eq!(to_fixed(0.125, 2), "0.13");
        assert_eq!(to_fixed(2.675, 2), "2.67");
        assert_eq!(locale_grouped_2(2.675), "2.68");
        assert_eq!(to_fixed(-0.001, 2), "-0.00");
        assert_eq!(to_fixed(1e21, 2), "1e+21");
        assert_eq!(locale_grouped_2(1234567.895), "1,234,567.90");
        assert_eq!(locale_grouped_2(1e21), "1,000,000,000,000,000,000,000.00");
        assert_eq!(locale_grouped_2(999.995), "1,000.00");
    }

    #[test]
    fn string_to_number_grammar() {
        assert_eq!(string_to_number(" 12.5 "), 12.5);
        assert_eq!(string_to_number(""), 0.0);
        assert_eq!(string_to_number(".5"), 0.5);
        assert_eq!(string_to_number("5."), 5.0);
        assert_eq!(string_to_number("0x10"), 16.0);
        assert_eq!(string_to_number("-Infinity"), f64::NEG_INFINITY);
        for bad in ["inf", "nan", "1e", "1,000", "-0x10", "Infinityx", "."] {
            assert!(string_to_number(bad).is_nan(), "{bad}");
        }
    }

    #[test]
    fn rounds_like_math_round() {
        assert_eq!(math_round(2.5), 3.0);
        assert_eq!(math_round(-2.5), -2.0);
        assert_eq!(math_round(0.49999999999999994), 0.0);
        assert_eq!(number_to_string(math_round(-0.2)), "0");
    }
}
