//! Token identity and the curated registry (`wallet_core::portfolio::registry`): the UniFFI
//! shapes and exports, over Bramble's registry and bundled-logo set (`networks::registry`,
//! generated from the extension).

use wallet_core::portfolio::registry as port;
pub use wallet_core::portfolio::registry::{SpamReason, TokenGlyph};

use super::model::TokenConfig;
use crate::networks::{self, NetworkId};

/// `tokenConfigId` over `withTokenId`'s canonical address: `<networkId>:<symbol>:<address>`.
#[uniffi::export]
pub fn token_config_id(network: NetworkId, symbol: String, address: String) -> String {
    port::token_config_id(network, symbol, address)
}

/// The curated registry for a network (`knownTokensForNetwork`), each with its id.
pub fn known_tokens(network: NetworkId) -> Vec<TokenConfig> {
    port::known_tokens(networks::registry(), network)
}

/// Why a token looks like spam (`SpamReason`).
#[uniffi::remote(Enum)]
pub enum SpamReason {
    EmptyName,
    AbsurdDecimals,
    SymbolSpoof,
}

/// `tokenSpamReasons` for a token config.
#[uniffi::export]
pub fn token_spam_reasons(token: TokenConfig) -> Vec<SpamReason> {
    port::token_spam_reasons(networks::registry(), token)
}

/// `tokenGlyph`: the bundled logo (keyed by 64-digit address) or a letter badge of the first
/// three symbol characters toned `BigInt(address) % 4` (JavaScript's signed remainder; anything
/// outside 0–3 renders the neutral badge).
#[uniffi::remote(Record)]
pub struct TokenGlyph {
    pub logo_address: Option<String>,
    pub letters: String,
    pub tone: i8,
}

/// `tokenGlyph(address, symbol)`.
#[uniffi::export]
pub fn token_glyph(address: String, symbol: String) -> TokenGlyph {
    port::token_glyph(networks::registry(), address, symbol)
}
