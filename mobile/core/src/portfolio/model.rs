//! Records shared by the portfolio and history modules. Every field is public metadata: token
//! configs, balances, prices, request and response bytes. Nothing here is derived from the vault.

use crate::networks::NetworkId;

/// Fiat display currency, as the extension's `DisplayCurrency`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, uniffi::Enum)]
pub enum DisplayCurrency {
    Usd,
    Eur,
    Gbp,
}

impl DisplayCurrency {
    /// The stored and CoinGecko spelling (`usd`, `eur`, `gbp`).
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Usd => "usd",
            Self::Eur => "eur",
            Self::Gbp => "gbp",
        }
    }

    pub(crate) fn from_code(code: &str) -> Option<Self> {
        match code {
            "usd" => Some(Self::Usd),
            "eur" => Some(Self::Eur),
            "gbp" => Some(Self::Gbp),
            _ => None,
        }
    }

    /// `CURRENCY_SYMBOLS`.
    pub(crate) fn symbol(self) -> &'static str {
        match self {
            Self::Usd => "$",
            Self::Eur => "€",
            Self::Gbp => "£",
        }
    }
}

/// The extension's `TokenConfig`: id `<networkId>:<symbol>:<canonicalAddress>`, the address in
/// its padded 64-digit spelling. Only `token_config_id` / `TokenPreferences` build one.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TokenConfig {
    pub id: String,
    pub network: NetworkId,
    pub address: String,
    pub symbol: String,
    pub name: String,
    pub decimals: u8,
}

/// A token with its balance: base-10 base units and `formatTokenAmount`'s full-precision text.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TokenBalance {
    pub token: TokenConfig,
    pub balance: String,
    pub formatted: String,
}

/// `networkId` spelling of a network (`SN_MAIN`, `SN_SEPOLIA`).
pub(crate) fn network_code(network: NetworkId) -> &'static str {
    network.catalog_id()
}

pub(crate) fn network_from_code(code: &str) -> Option<NetworkId> {
    [NetworkId::Mainnet, NetworkId::Sepolia]
        .into_iter()
        .find(|network| network.catalog_id() == code)
}
