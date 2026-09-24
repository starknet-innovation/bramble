//! Account names and truncation, reproducing the extension's side-panel rules exactly
//! (`parts.ts` `friendlyAccountName` / `accountDisplayName` / `accountLabel`, and the 1-64 trimmed
//! label rule of `wallet-model/preferences`). JavaScript semantics are kept where they show:
//! `BigInt(text)` parsing, `String.prototype.trim` whitespace, and UTF-16 lengths and slices.
//! `tests/fixtures/accounts-parity.json` pins every rule to the extension's own output.

use crate::account_catalog::catalog;
use crate::CoreError;

/// Longest account label, in UTF-16 code units (the extension's `.length`).
pub(crate) const MAX_LABEL_UNITS: usize = 64;
/// `NAME_ADJECTIVES.length * 131`: `a mod 30` and `(a div 131) mod 30` both follow from `a mod 3930`.
const NAME_MODULUS: u32 = 3930;

/// Whether `c` is removed by JavaScript's `trim()` (WhiteSpace and LineTerminator). Rust's
/// `is_whitespace` adds U+0085 and omits U+FEFF, so both are special-cased.
fn is_js_whitespace(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

/// JavaScript `String.prototype.trim`.
pub(crate) fn js_trim(value: &str) -> &str {
    value.trim_matches(is_js_whitespace)
}

/// JavaScript `.length`: UTF-16 code units.
pub(crate) fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

/// `a mod 3930` for the value JavaScript's `BigInt(text)` would parse, or `None` where `BigInt`
/// throws (the extension then uses zero). A negative decimal also yields zero: its remainders are
/// negative, which index nothing, so the extension falls back to the first words either way.
fn bigint_residue(text: &str) -> Option<u32> {
    let text = js_trim(text);
    if text.is_empty() {
        return Some(0);
    }
    let (radix, digits, negative) = match text.get(..2) {
        Some("0x" | "0X") => (16, &text[2..], false),
        Some("0o" | "0O") => (8, &text[2..], false),
        Some("0b" | "0B") => (2, &text[2..], false),
        _ => match text.strip_prefix('-') {
            Some(rest) => (10, rest, true),
            None => (10, text.strip_prefix('+').unwrap_or(text), false),
        },
    };
    if digits.is_empty() {
        return None;
    }
    let mut residue = 0u32;
    for c in digits.chars() {
        let digit = c.to_digit(radix)?;
        residue = (residue * radix + digit) % NAME_MODULUS;
    }
    Some(if negative { 0 } else { residue })
}

/// `friendlyAccountName`: a deterministic two-word nickname for an address.
pub fn friendly_name(address: &str) -> String {
    let residue = bigint_residue(address).unwrap_or(0);
    let words = catalog();
    let adjective = &words.adjectives[(residue % 30) as usize];
    let animal = &words.animals[(residue / 131) as usize];
    format!("{adjective} {animal}")
}

/// `accountDisplayName`: the user's label when set, else the nickname.
pub fn display_name(address: &str, label: Option<&str>) -> String {
    label.map_or_else(|| friendly_name(address), str::to_string)
}

fn utf16_slice(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

/// `a.slice(0, head) + "…" + a.slice(-tail)`, on UTF-16 units, with no length guard (as in JS).
fn truncate(value: &str, head: usize, tail: usize) -> String {
    let units: Vec<u16> = value.encode_utf16().collect();
    let start = &units[..head.min(units.len())];
    let end = &units[units.len().saturating_sub(tail)..];
    format!("{}…{}", utf16_slice(start), utf16_slice(end))
}

/// `accountLabel` / `shortAddress`: `0x1234…abcd`.
pub fn short_label(value: &str) -> String {
    truncate(value, 6, 4)
}

/// The onboarding review step's longer preview, `slice(0, 10) + "…" + slice(-8)`.
pub fn preview_label(value: &str) -> String {
    truncate(value, 10, 8)
}

/// The shared 1-64 trimmed-label rule (`isLabel`).
pub fn is_label(value: &str) -> bool {
    let units = utf16_len(js_trim(value));
    (1..=MAX_LABEL_UNITS).contains(&units)
}

/// `setAccountLabel` normalisation: trimmed; empty clears (None); otherwise it must be a label.
pub(crate) fn normalise_label(value: &str) -> Result<Option<String>, CoreError> {
    let trimmed = js_trim(value);
    if trimmed.is_empty() {
        return Ok(None);
    }
    if !is_label(trimmed) {
        return Err(CoreError::InvalidInput {
            reason: "invalid account label".into(),
        });
    }
    Ok(Some(trimmed.to_string()))
}

/// Deterministic two-word nickname for an address, as the extension's `friendlyAccountName`.
#[uniffi::export]
pub fn friendly_account_name(address: String) -> String {
    friendly_name(&address)
}

/// The name shown for an account: its label, else its nickname (`accountDisplayName`).
#[uniffi::export]
pub fn account_display_name(address: String, label: Option<String>) -> String {
    display_name(&address, label.as_deref())
}

/// Truncated address for rows and headers (`accountLabel`, 6…4). The full value is always the one
/// copied, shown in full on Receive, and exposed as the accessibility value.
#[uniffi::export]
pub fn account_label(address: String) -> String {
    short_label(&address)
}

/// The onboarding review step's preview (10…8).
#[uniffi::export]
pub fn account_preview_label(address: String) -> String {
    preview_label(&address)
}

/// Whether text is an acceptable account label once trimmed (1-64 UTF-16 units).
#[uniffi::export]
pub fn is_account_label(label: String) -> bool {
    is_label(&label)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nicknames_follow_bigint_parsing() {
        assert_eq!(friendly_name("0x0"), "Amber Otter");
        assert_eq!(friendly_name("0x1"), "Bold Otter");
        assert_eq!(friendly_name("0x83"), "Keen Falcon");
        assert_eq!(friendly_name("not an address"), "Amber Otter");
        assert_eq!(friendly_name("0x"), "Amber Otter");
        assert_eq!(friendly_name("-45"), "Amber Otter");
        assert_eq!(friendly_name(" 131 "), friendly_name("0x83"));
    }

    #[test]
    fn truncation_is_on_utf16_units_without_a_guard() {
        assert_eq!(short_label("0x0"), "0x0…0x0");
        assert_eq!(short_label("0xf5a"), "0xf5a…xf5a");
        assert_eq!(
            preview_label("0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9"),
            "0x208361e3…44b398d9"
        );
    }

    #[test]
    fn labels_trim_and_count_utf16() {
        assert_eq!(
            normalise_label("  Savings ").unwrap().as_deref(),
            Some("Savings")
        );
        assert_eq!(normalise_label("\u{feff} ").unwrap(), None);
        assert!(is_label(&"🔥".repeat(32)));
        assert!(!is_label(&"🔥".repeat(33)));
        assert!(normalise_label(&"a".repeat(65)).is_err());
        assert!(
            is_label("\u{85}"),
            "JS trim keeps NEL, so it is a one-unit label"
        );
    }
}
