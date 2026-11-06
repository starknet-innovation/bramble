//! The extension's felt helpers that go through `BigInt(string)` rather than the strict grammar in
//! `crate::felt`: `canonicalFelt`, `sameFelt`, `asFelt`, `uint256Felts`, `paddedFelt`,
//! `canonicalAddress` (`wallet-model/networks`). Untrusted RPC and explorer text reaches these,
//! and the extension accepts decimal and upper-case spellings there, so mobile must too.

use super::big::{parse_bigint, JsBigInt};
use super::json::JsValue;
use super::num::js_trim;

/// `isStarkFieldElement`: `0x` + 1–64 lowercase hex digits, below the field prime.
pub fn is_stark_field_element(value: &str) -> bool {
    crate::felt::parse(value).is_some()
}

/// `isNonZeroStarkFieldElement`.
pub fn is_non_zero_felt(value: &str) -> bool {
    crate::felt::parse_non_zero(value).is_some()
}

/// `canonicalFelt`: `0x` + `BigInt(value).toString(16)` (so `-5` gives `0x-5`, which every caller
/// then rejects as a field element), or `None` where `BigInt` throws.
pub fn canonical_felt(value: &str) -> Option<String> {
    parse_bigint(value).map(|b| format!("0x{}", b.to_hex_string()))
}

fn same_value(a: &JsBigInt, b: &JsBigInt) -> bool {
    a.magnitude == b.magnitude && (a.negative == b.negative || a.magnitude.is_zero())
}

/// `sameFelt`: both non-empty strings whose `BigInt` values are equal.
pub fn same_felt(left: &str, right: &str) -> bool {
    if left.is_empty() || right.is_empty() {
        return false;
    }
    match (parse_bigint(left), parse_bigint(right)) {
        (Some(a), Some(b)) => same_value(&a, &b),
        _ => false,
    }
}

/// `sameFelt` over untyped JSON values (anything but a non-empty string is never the same).
pub fn same_felt_value(left: Option<&JsValue>, right: &str) -> bool {
    left.and_then(JsValue::as_str)
        .is_some_and(|left| same_felt(left, right))
}

/// `asFelt`: a non-empty string parsed with `BigInt`.
pub fn as_felt(value: Option<&JsValue>) -> Option<JsBigInt> {
    let text = value?.as_str()?;
    if text.is_empty() {
        return None;
    }
    parse_bigint(text)
}

/// `uint256Felts(low, high)` as `(low, high)` limbs, each a non-negative felt below 2^128.
pub fn uint256_felts(low: Option<&JsValue>, high: Option<&JsValue>) -> Option<(u128, u128)> {
    let limb = |value: Option<&JsValue>| {
        let parsed = as_felt(value)?;
        if parsed.negative && !parsed.magnitude.is_zero() {
            return None;
        }
        parsed.magnitude.to_u128()
    };
    Some((limb(low)?, limb(high)?))
}

/// `paddedFelt`: trimmed, lowercased, a field element, rendered at 64 digits.
pub fn padded_felt(value: &str) -> Option<String> {
    let lower = js_trim(value).to_lowercase();
    let felt = crate::felt::parse(&lower)?;
    let hex = format!("{felt:x}");
    Some(format!("0x{hex:0>64}"))
}

/// `canonicalAddress`: `paddedFelt` of a non-zero field element; `None` otherwise.
pub fn canonical_address(value: &str) -> Option<String> {
    let lower = js_trim(value).to_lowercase();
    crate::felt::parse_non_zero(&lower)?;
    padded_felt(&lower)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn felt_helpers_follow_bigint() {
        assert_eq!(canonical_felt("0x00AB").as_deref(), Some("0xab"));
        assert_eq!(canonical_felt("171").as_deref(), Some("0xab"));
        assert_eq!(canonical_felt("-5").as_deref(), Some("0x-5"));
        assert_eq!(canonical_felt("xyz"), None);
        assert!(same_felt("0x0ab", "171"));
        assert!(!same_felt("", "0x0"));
        assert_eq!(
            canonical_address(" 0xAB ").as_deref(),
            Some("0x00000000000000000000000000000000000000000000000000000000000000ab")
        );
        assert_eq!(canonical_address("0x0"), None);
        let two = |a: &str, b: &str| {
            uint256_felts(
                Some(&JsValue::String(a.into())),
                Some(&JsValue::String(b.into())),
            )
        };
        assert_eq!(two("0x10", "0"), Some((16, 0)));
        assert_eq!(two("-1", "0"), None);
        assert_eq!(two(&format!("0x1{}", "0".repeat(32)), "0"), None);
        assert_eq!(two("", "0"), None);
    }
}
