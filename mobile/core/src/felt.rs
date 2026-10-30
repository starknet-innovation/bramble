//! Felt grammar shared with the extension's `wallet-model/networks` helpers.
//!
//! Untrusted text is a felt only in the extension's own spelling: `0x` followed by 1–64
//! lowercase hex digits, below the field prime. The native apps pass addresses and hashes
//! through this module, never through their own parsers, so the two wallets cannot disagree
//! about which strings name the same value.

use starknet_types_core::felt::Felt;

/// Stark curve order `n`; a signing scalar must lie in `[1, n)`.
const STARK_CURVE_ORDER_HEX: &str =
    "0x0800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2f";

/// Parses a felt in the extension's lowercase-hex grammar, rejecting values at or above the prime.
pub fn parse(value: &str) -> Option<Felt> {
    let digits = value.strip_prefix("0x")?;
    if digits.is_empty()
        || digits.len() > 64
        || !digits
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return None;
    }
    // `Felt::from_hex` reduces modulo the prime; a value that does not round-trip was out of range.
    let felt = Felt::from_hex(value).ok()?;
    let trimmed = digits.trim_start_matches('0');
    let canonical_digits = format!("{felt:x}");
    let same = if trimmed.is_empty() {
        felt == Felt::ZERO
    } else {
        canonical_digits == trimmed
    };
    same.then_some(felt)
}

/// Parses a non-zero felt.
pub fn parse_non_zero(value: &str) -> Option<Felt> {
    parse(value).filter(|felt| *felt != Felt::ZERO)
}

/// The extension's canonical spelling: `0x` plus minimal lowercase hex (`0x0` for zero).
pub fn canonical(felt: &Felt) -> String {
    format!("{felt:#x}")
}

/// Whether a felt is a usable Stark signing scalar, `1 <= k < n`.
pub fn is_private_key(felt: &Felt) -> bool {
    let order = Felt::from_hex(STARK_CURVE_ORDER_HEX).expect("curve order constant is a felt");
    *felt != Felt::ZERO && *felt < order
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_extension_grammar_only() {
        assert_eq!(parse("0x0"), Some(Felt::ZERO));
        assert_eq!(
            parse("0x00ff").map(|f| canonical(&f)),
            Some("0xff".to_string())
        );
        for bad in ["", "0x", "ff", "0xFF", "0x-1", " 0x1", "0x1 ", "0xg"] {
            assert_eq!(parse(bad), None, "{bad:?}");
        }
        assert_eq!(parse(&format!("0x{}", "0".repeat(65))), None);
    }

    #[test]
    fn rejects_values_at_or_above_the_prime() {
        let prime = "0x800000000000011000000000000000000000000000000000000000000000001";
        assert_eq!(parse(prime), None);
        let below = "0x800000000000011000000000000000000000000000000000000000000000000";
        assert!(parse(below).is_some());
    }

    #[test]
    fn private_key_range_is_the_curve_order() {
        assert!(!is_private_key(&Felt::ZERO));
        assert!(is_private_key(&Felt::ONE));
        let order = Felt::from_hex(STARK_CURVE_ORDER_HEX).unwrap();
        assert!(!is_private_key(&order));
        assert!(is_private_key(&(order - Felt::ONE)));
    }
}
