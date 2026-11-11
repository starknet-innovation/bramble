//! Records shared by the portfolio and history modules. Every field is public metadata: token
//! configs, balances, prices, request and response bytes. Nothing here is derived from the vault.
//! The types are `wallet_core::portfolio::model`'s; their UniFFI shapes are declared here.

pub use wallet_core::portfolio::model::{DisplayCurrency, TokenBalance, TokenConfig};

use crate::networks::NetworkId;

/// Fiat display currency, as the extension's `DisplayCurrency`.
#[uniffi::remote(Enum)]
pub enum DisplayCurrency {
    Usd,
    Eur,
    Gbp,
}

/// The extension's `TokenConfig`: id `<networkId>:<symbol>:<canonicalAddress>`, the address in
/// its padded 64-digit spelling. Only `token_config_id` / `TokenPreferences` build one.
#[uniffi::remote(Record)]
pub struct TokenConfig {
    pub id: String,
    pub network: NetworkId,
    pub address: String,
    pub symbol: String,
    pub name: String,
    pub decimals: u8,
}

/// A token with its balance: base-10 base units and `formatTokenAmount`'s full-precision text.
#[uniffi::remote(Record)]
pub struct TokenBalance {
    pub token: TokenConfig,
    pub balance: String,
    pub formatted: String,
}
