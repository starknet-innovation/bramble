//! The versioned wallet contact card, `mcw:contact:1:<network>:<address>:<signer key|->:<nostr|->`,
//! exactly as `walletContactCard` / `parseWalletContactCard` in `wallet-model/preferences`.
//!
//! A card carries only public values. Parsing is strict about structure and lenient exactly where
//! the extension is lenient: hex digits may be upper-case and may end in JavaScript whitespace,
//! because the extension reads them through `BigInt` and `String.prototype.trim`.

use starknet_types_core::felt::Felt;

use crate::networks::NetworkId;
use crate::{felt, multisig_constants, nostr, CoreError};

const PREFIX: &str = "mcw:contact:1:";
const MAX_CARD_LENGTH: usize = 512;

/// Public identity carried by a wallet card. The address is in the card's padded 64-digit form.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct WalletContactCard {
    pub network: NetworkId,
    pub address: String,
    pub public_key_x: Option<String>,
    pub nostr_public_key: Option<String>,
}

/// What a pasted card turned out to be, for the extension's two card error messages.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum ContactCardParse {
    Valid {
        card: WalletContactCard,
    },
    /// A well-formed card for another network: "…belongs to a different network."
    OtherNetwork,
    /// Anything else: "That wallet card is not recognized."
    Unrecognized,
}

/// JavaScript's `WhiteSpace` and `LineTerminator` code points, which `trim` and `BigInt` skip.
fn is_js_whitespace(c: char) -> bool {
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

/// Trims JavaScript whitespace from both ends, as `String.prototype.trim`.
pub fn js_trim(value: &str) -> &str {
    value.trim_matches(is_js_whitespace)
}

/// Hex digits (any case) to a felt below the prime; `None` for anything else.
fn hex_digits(digits: &str) -> Option<Felt> {
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let significant = digits.trim_start_matches('0').to_ascii_lowercase();
    if significant.len() > 64 {
        return None;
    }
    felt::parse(&format!(
        "0x{}",
        if significant.is_empty() {
            "0"
        } else {
            &significant
        }
    ))
}

/// `canonicalFelt(value)` for `0x`-prefixed hex, non-zero: `BigInt` accepts trailing whitespace
/// and any digit case. Returns the canonical (minimal) felt.
pub fn lenient_hex_felt(value: &str) -> Option<Felt> {
    let digits = value.strip_prefix("0x")?;
    hex_digits(digits.trim_end_matches(is_js_whitespace)).filter(|f| *f != Felt::ZERO)
}

/// `canonicalAddress`: trimmed, lower-cased, at most 64 hex digits, non-zero; padded form.
pub fn canonical_address(value: &str) -> Option<String> {
    let lower = js_trim(value).to_ascii_lowercase();
    let digits = lower.strip_prefix("0x")?;
    if digits.len() > 64
        || !digits
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return None;
    }
    hex_digits(digits)
        .filter(|f| *f != Felt::ZERO)
        .map(|f| padded(&f))
}

/// A felt at its full 64-digit width, `0x`-prefixed.
pub fn padded(value: &Felt) -> String {
    format!("0x{:0>64}", format!("{value:x}"))
}

/// Encodes a validated card; fails closed on any malformed part.
pub fn encode(card: &WalletContactCard) -> Result<String, CoreError> {
    let invalid = || CoreError::InvalidInput {
        reason: "invalid wallet contact card".into(),
    };
    let address = canonical_address(&card.address).ok_or_else(invalid)?;
    let public_key = match &card.public_key_x {
        Some(key) => Some(felt::parse_non_zero(key).ok_or_else(invalid)?),
        None => None,
    };
    if card
        .nostr_public_key
        .as_deref()
        .is_some_and(|key| !nostr::is_public_key(key))
    {
        return Err(invalid());
    }
    Ok(format!(
        "{PREFIX}{}:{}:{}:{}",
        card.network.catalog_id(),
        &address[2..],
        public_key.map_or_else(|| "-".to_string(), |key| format!("{key:x}")),
        card.nostr_public_key.as_deref().unwrap_or("-"),
    ))
}

/// Parses an untrusted card, telling another network's card apart from an unrecognised one.
pub fn parse(text: &str, network: NetworkId) -> ContactCardParse {
    // `value.length > 512` counts UTF-16 code units.
    if nostr::utf16_length(text) > MAX_CARD_LENGTH {
        return ContactCardParse::Unrecognized;
    }
    let Some(body) = text.strip_prefix(PREFIX) else {
        return ContactCardParse::Unrecognized;
    };
    let parts: Vec<&str> = body.split(':').collect();
    if parts.len() != 4 {
        return ContactCardParse::Unrecognized;
    }
    let (network_id, address_hex, key_hex, nostr_key) = (parts[0], parts[1], parts[2], parts[3]);
    let known_network = multisig_constants::get()
        .card_network_ids
        .iter()
        .any(|id| id == network_id);
    let address = canonical_address(&format!("0x{address_hex}"));
    let public_key = if key_hex == "-" {
        None
    } else {
        match lenient_hex_felt(&format!("0x{key_hex}")) {
            Some(key) => Some(felt::canonical(&key)),
            None => return ContactCardParse::Unrecognized,
        }
    };
    if !known_network || address.is_none() || (nostr_key != "-" && !nostr::is_public_key(nostr_key))
    {
        return ContactCardParse::Unrecognized;
    }
    match crate::contacts::network_from_catalog_id(network_id) {
        Some(card_network) if card_network == network => ContactCardParse::Valid {
            card: WalletContactCard {
                network,
                address: address.unwrap_or_default(),
                public_key_x: public_key,
                nostr_public_key: (nostr_key != "-").then(|| nostr_key.to_string()),
            },
        },
        _ => ContactCardParse::OtherNetwork,
    }
}

/// `shortAddress`: the first six and last four characters around an ellipsis.
pub fn short_key(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    let head: String = chars.iter().take(6).collect();
    let tail: String = chars[chars.len().saturating_sub(4)..].iter().collect();
    format!("{head}…{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card() -> WalletContactCard {
        WalletContactCard {
            network: NetworkId::Mainnet,
            address: "0x123".into(),
            public_key_x: Some("0x456".into()),
            nostr_public_key: Some("11".repeat(32)),
        }
    }

    #[test]
    fn round_trips_like_the_extension() {
        let encoded = encode(&card()).unwrap();
        assert!(encoded.starts_with("mcw:contact:1:SN_MAIN:"));
        let expected = WalletContactCard {
            address: format!("0x{}123", "0".repeat(61)),
            ..card()
        };
        assert_eq!(
            parse(&encoded, NetworkId::Mainnet),
            ContactCardParse::Valid { card: expected }
        );
        assert_eq!(
            parse(&encoded, NetworkId::Sepolia),
            ContactCardParse::OtherNetwork
        );
    }

    #[test]
    fn rejects_malformed_cards() {
        let encoded = encode(&card()).unwrap();
        for bad in [
            encoded.replace("contact:1", "contact:2"),
            format!("{encoded}:extra"),
            "m".repeat(513),
            encoded.replace(&"11".repeat(32), "0x11"),
            "mcw:contact:1:SN_MAIN:0:456:-".into(),
            "mcw:contact:1:SN_OTHER:123:456:-".into(),
        ] {
            assert_eq!(
                parse(&bad, NetworkId::Mainnet),
                ContactCardParse::Unrecognized,
                "{bad}"
            );
        }
        assert!(encode(&WalletContactCard {
            nostr_public_key: Some("0x11".into()),
            ..card()
        })
        .is_err());
    }

    #[test]
    fn short_key_matches_short_address() {
        assert_eq!(short_key("0x0123456789abcdef"), "0x0123…cdef");
        assert_eq!(short_key("abc"), "abc…abc");
    }
}
