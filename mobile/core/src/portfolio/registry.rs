//! Token identity and the curated registry: `wallet-model/preferences` (`tokenConfigId`,
//! `withTokenId`, `isTokenConfig`, `isTokenSymbol`, `isTokenName`), `portfolio/token-registry.ts`
//! (`knownTokensForNetwork`, symbol folding, `LEGITIMATE_ALIASES`, `tokenSpamReasons`) and the
//! side panel's `tokenGlyph`. The registry and the bundled-logo set are generated from the
//! extension (`generated/token-registry.json`), never restated here.

use std::sync::OnceLock;

use serde::Deserialize;

use super::model::{network_code, TokenConfig};
use crate::js::big::parse_bigint;
use crate::js::felt::{canonical_address, same_felt};
use crate::js::num::{js_trim, utf16_len, utf16_slice};
use crate::networks::{self, NetworkId};

const REGISTRY_JSON: &str = include_str!("../../generated/token-registry.json");
const MAX_PLAUSIBLE_DECIMALS: u8 = 24;
/// Registry symbols with an allow-listed second deployment (`LEGITIMATE_ALIASES`).
const LEGITIMATE_ALIASES: &[(&str, &[&str])] = &[(
    "USDC",
    &["0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8"],
)];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryEntry {
    address: String,
    decimals: u8,
    name: String,
    network_id: String,
    symbol: String,
}

#[derive(Deserialize)]
struct Registry {
    tokens: Vec<RegistryEntry>,
    logos: Vec<String>,
}

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY
        .get_or_init(|| serde_json::from_str(REGISTRY_JSON).expect("bundled token registry parses"))
}

/// `tokenConfigId` over `withTokenId`'s canonical address: `<networkId>:<symbol>:<address>`.
#[uniffi::export]
pub fn token_config_id(network: NetworkId, symbol: String, address: String) -> String {
    let address = canonical_address(&address).unwrap_or(address);
    format!("{}:{symbol}:{address}", network_code(network))
}

/// `withTokenId`: canonical address in place and the derived id.
pub(crate) fn with_token_id(
    network: NetworkId,
    address: &str,
    symbol: &str,
    name: &str,
    decimals: u8,
) -> TokenConfig {
    let address = canonical_address(address).unwrap_or_else(|| address.to_string());
    TokenConfig {
        id: format!("{}:{symbol}:{address}", network_code(network)),
        network,
        address,
        symbol: symbol.to_string(),
        name: name.to_string(),
        decimals,
    }
}

/// `isTokenSymbol`: `^[A-Z0-9]{2,12}$`.
pub(crate) fn is_token_symbol(symbol: &str) -> bool {
    (2..=12).contains(&symbol.len())
        && symbol
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}

/// `isTokenName`: 1–64 printable ASCII characters without angle brackets.
pub(crate) fn is_token_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|b| (0x20..=0x7e).contains(&b) && b != b'<' && b != b'>')
}

/// `isTokenConfig`.
pub fn is_token_config(token: &TokenConfig) -> bool {
    let name_len = utf16_len(js_trim(&token.name));
    crate::felt::parse_non_zero(&token.address).is_some()
        && canonical_address(&token.address).as_deref() == Some(token.address.as_str())
        && token.decimals <= 36
        && (1..=64).contains(&name_len)
        && is_token_symbol(&token.symbol)
        && token.id
            == format!(
                "{}:{}:{}",
                network_code(token.network),
                token.symbol,
                token.address
            )
}

/// The curated registry for a network (`knownTokensForNetwork`), each with its id.
pub fn known_tokens(network: NetworkId) -> Vec<TokenConfig> {
    registry()
        .tokens
        .iter()
        .filter(|t| t.network_id == network_code(network))
        .map(|t| with_token_id(network, &t.address, &t.symbol, &t.name, t.decimals))
        .collect()
}

fn fold_symbol(symbol: &str) -> String {
    let stripped: String = symbol
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        .collect();
    stripped
        .replace("vv", "w")
        .replace("rn", "m")
        .chars()
        .map(|c| match c {
            '0' => 'o',
            '1' | 'i' => 'l',
            '3' => 'e',
            '4' => 'a',
            '5' => 's',
            '7' => 't',
            '8' => 'b',
            'v' => 'u',
            c => c,
        })
        .collect()
}

/// Why a token looks like spam (`SpamReason`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum SpamReason {
    EmptyName,
    AbsurdDecimals,
    SymbolSpoof,
}

/// `tokenSpamReasons`.
pub fn spam_reasons(
    network: NetworkId,
    address: &str,
    symbol: &str,
    name: &str,
    decimals: u8,
) -> Vec<SpamReason> {
    let mut reasons = Vec::new();
    if js_trim(name).is_empty() {
        reasons.push(SpamReason::EmptyName);
    }
    if decimals > MAX_PLAUSIBLE_DECIMALS {
        reasons.push(SpamReason::AbsurdDecimals);
    }
    let folded = fold_symbol(symbol);
    let spoofs = known_tokens(network).iter().any(|known| {
        if fold_symbol(&known.symbol) != folded || same_felt(&known.address, address) {
            return false;
        }
        let aliases = LEGITIMATE_ALIASES
            .iter()
            .find(|(s, _)| *s == known.symbol)
            .map_or(&[][..], |(_, a)| *a);
        !aliases.iter().any(|alias| same_felt(alias, address))
    });
    if spoofs {
        reasons.push(SpamReason::SymbolSpoof);
    }
    reasons
}

/// `tokenSpamReasons` for a token config.
#[uniffi::export]
pub fn token_spam_reasons(token: TokenConfig) -> Vec<SpamReason> {
    spam_reasons(
        token.network,
        &token.address,
        &token.symbol,
        &token.name,
        token.decimals,
    )
}

/// `tokenGlyph`: the bundled logo (keyed by 64-digit address) or a letter badge of the first
/// three symbol characters toned `BigInt(address) % 4` (JavaScript's signed remainder; anything
/// outside 0–3 renders the neutral badge).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TokenGlyph {
    pub logo_address: Option<String>,
    pub letters: String,
    pub tone: i8,
}

/// `tokenGlyph(address, symbol)`.
#[uniffi::export]
pub fn token_glyph(address: String, symbol: String) -> TokenGlyph {
    let logo = parse_bigint(&js_trim(&address).to_lowercase())
        .map(|b| format!("0x{:0>64}", b.to_hex_string()))
        .filter(|key| registry().logos.iter().any(|l| l == key));
    let tone = parse_bigint(&address).map_or(0, |b| {
        let hex = b.magnitude.to_hex();
        let low = hex.chars().last().and_then(|c| c.to_digit(16)).unwrap_or(0) as i8 % 4;
        if b.negative {
            -low
        } else {
            low
        }
    });
    TokenGlyph {
        logo_address: logo,
        letters: utf16_slice(&symbol, 0, 3),
        tone,
    }
}

/// The Starknet network mark (`starknetNetworkGlyph`): STRK's glyph.
pub(crate) fn starknet_glyph() -> TokenGlyph {
    token_glyph(strk_address().to_string(), "STRK".into())
}

/// `STRK_TOKEN_ADDRESS`, read from the generated catalog rather than restated.
pub(crate) fn strk_address() -> &'static str {
    &networks::info(NetworkId::Mainnet)
        .tokens
        .iter()
        .find(|t| t.symbol == "STRK")
        .expect("the catalog seeds STRK")
        .address
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folds_confusables() {
        assert_eq!(fold_symbol("USDC"), fold_symbol("U5DC"));
        assert_eq!(fold_symbol("WBTC"), fold_symbol("VVBTC"));
        assert_eq!(fold_symbol("STRK"), "strk");
    }

    #[test]
    fn glyph_tone_and_letters() {
        let glyph = token_glyph("0x7".into(), "ABCDE".into());
        assert_eq!(
            (glyph.letters.as_str(), glyph.tone, glyph.logo_address),
            ("ABC", 3, None)
        );
        assert!(token_glyph(strk_address().into(), "STRK".into())
            .logo_address
            .is_some());
    }
}
