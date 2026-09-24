//! Bramble mobile core.
//!
//! The Rust middleware shared by the iOS and Android wallets. It is the mobile counterpart of the
//! extension's background service: Krusty KMS key custody (`kms`), the encrypted vault
//! (`vault`, byte-compatible with the extension envelope), the bundled network catalog
//! (`networks`), and sans-IO Starknet RPC (`rpc`). The native apps render UI and move bytes;
//! they never see a private key.
//!
//! Errors carry an operation name or a fixed reason, never input text, so nothing a user typed
//! can reach a log through an error message.

mod felt;
mod history;
mod js;
mod kms;
mod networks;
mod portfolio;
#[doc(hidden)]
pub mod portfolio_testing;
mod rpc;
mod ui;
mod vault;
mod wallet;

pub use networks::{NetworkId, NetworkInfo, TokenInfo};
pub use ui::{AccountAvatar, PassphraseLevel, PassphraseStrength};
pub use wallet::{AccountInfo, RecoveryPhrase, StarkSignature, WalletCore, WalletStatus};

// Portfolio and activity (mobile/docs/portfolio-activity.md).
pub use history::activity::{ActivityEntry, ActivityKind, ActivityStatus, FailureNotice};
pub use history::activity_book::{ActivityBook, ActivityView};
pub use history::appearance::{
    activity_empty_copy, activity_groups, activity_unavailable_notice, ActivityDayGroup,
    ActivityDirection, ActivityRow, ActivityTone,
};
pub use history::events::{HistoryScan, ScanStep};
pub use history::explorer::{activity_account_id, explorer_transaction_url};
pub use portfolio::fiat::{
    compact_amount, fiat_value_text, format_fiat, portfolio_amount, portfolio_hero, token_row_fiat,
    token_sparkline, ChangeBadge, FiatDelta, PortfolioHero, Sparkline, SparklinePoint,
    SparklineTrend,
};
pub use portfolio::model::{DisplayCurrency, TokenBalance, TokenConfig};
pub use portfolio::prices::{
    ChartPlan, PriceBook, PriceOutcome, PricePlan, PricePoint, PriceRequest, PriceView,
};
pub use portfolio::snapshots::{
    balance_failure_copy, friendly_network_error, network_data_issue, BalanceHealth, BalancePlan,
    BalanceSnapshots, BalanceView,
};
pub use portfolio::token_meta::{
    balance_judge, balance_requests, discovery_judge, token_add_address, token_metadata_judge,
    token_metadata_requests, token_network_error, BalanceOutcome, DiscoveryOutcome,
    TokenMetaOutcome,
};
pub use portfolio::tokens::{
    token_config_id, token_glyph, token_spam_reasons, AddTokenOutcome, HomeRows, SpamReason,
    TokenGlyph, TokenPreferences, TrackedToken,
};
pub use portfolio::wire::{
    rpc_limits, HttpHeader, HttpMethod, HttpOutcome, HttpRequest, RpcCall, RpcLimits, RpcReply,
};

uniffi::setup_scaffolding!();

/// Every failure the core reports across the FFI boundary.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum CoreError {
    #[error("invalid input: {reason}")]
    InvalidInput { reason: String },
    #[error("wrong password")]
    WrongPassword,
    #[error("wallet is locked")]
    Locked,
    #[error("no wallet on this device")]
    NoWallet,
    #[error("a wallet already exists on this device")]
    WalletExists,
    #[error("storage failure: {reason}")]
    Storage { reason: String },
    #[error("key management failure during {operation}")]
    Kms { operation: String },
    #[error("rpc failure: {reason}")]
    Rpc { reason: String },
}

/// Versions compiled into this core, for the About screen and bug reports.
#[derive(Debug, Clone, uniffi::Record)]
pub struct CoreInfo {
    pub core_version: String,
    pub krusty_version: String,
}

/// Build information.
#[uniffi::export]
pub fn core_info() -> CoreInfo {
    CoreInfo {
        core_version: env!("CARGO_PKG_VERSION").into(),
        krusty_version: "0.11.0".into(),
    }
}

/// The bundled networks.
#[uniffi::export]
pub fn supported_networks() -> Vec<NetworkInfo> {
    networks::all().to_vec()
}

/// Whether phrase text (any spacing or case) is a valid recovery phrase, for live form feedback.
#[uniffi::export]
pub fn is_valid_recovery_phrase(phrase: String) -> bool {
    kms::validate_mnemonic(&kms::normalise_phrase(&zeroize::Zeroizing::new(phrase)))
}

/// JSON-RPC body asking a node for its chain id.
#[uniffi::export]
pub fn rpc_chain_id_request(id: u64) -> String {
    rpc::chain_id_request(id)
}

/// Whether a chain-id response proves the endpoint serves `network`.
#[uniffi::export]
pub fn rpc_verify_chain_id(body: String, id: u64, network: NetworkId) -> Result<bool, CoreError> {
    rpc::verify_chain_id(&body, id, network)
}

/// JSON-RPC body for an ERC-20 balance query.
#[uniffi::export]
pub fn rpc_balance_request(id: u64, token: String, account: String) -> Result<String, CoreError> {
    rpc::balance_of_request(id, &token, &account)
}

/// Base-10 base-unit balance from a balance response.
#[uniffi::export]
pub fn rpc_parse_balance(body: String, id: u64) -> Result<String, CoreError> {
    rpc::parse_balance_of(&body, id)
}

/// Avatar geometry for an account address, identical to the extension's `accountAvatar`.
#[uniffi::export]
pub fn account_avatar(address: String) -> AccountAvatar {
    ui::account_avatar(&address)
}

/// Vault-passphrase meter reading, identical to the extension's `estimatePassphraseStrength`.
#[uniffi::export]
pub fn passphrase_strength(passphrase: String) -> PassphraseStrength {
    ui::passphrase_strength(&passphrase)
}

/// Whether a typed word is in the BIP-39 English list (flags unknown words as the user types).
#[uniffi::export]
pub fn is_recovery_word(word: String) -> bool {
    ui::is_recovery_word(&word)
}

/// Up to five BIP-39 words completing a typed prefix.
#[uniffi::export]
pub fn recovery_word_suggestions(prefix: String) -> Vec<String> {
    ui::recovery_word_suggestions(&prefix)
}

/// Public explorer page for an account, as the extension's `explorerAccountUrl`: the address in
/// the spelling given; `None` when it is not a well-formed non-zero felt, so no caller can build
/// a link that cannot resolve.
#[uniffi::export]
pub fn explorer_account_url(network: NetworkId, address: String) -> Option<String> {
    history::explorer::explorer_url(network, "contract", &address)
}

/// Display string for a base-unit amount.
#[uniffi::export]
pub fn format_token_amount(
    raw: String,
    decimals: u8,
    max_fraction: u8,
) -> Result<String, CoreError> {
    rpc::format_amount(&raw, decimals, max_fraction)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explorer_urls_match_the_extension() {
        assert_eq!(
            explorer_account_url(NetworkId::Mainnet, "0x00ab".into()).as_deref(),
            Some("https://starkscan.co/contract/0x00ab")
        );
        assert_eq!(explorer_account_url(NetworkId::Sepolia, "0x0".into()), None);
        assert_eq!(
            explorer_account_url(NetworkId::Sepolia, "0xAB".into()),
            None
        );
    }
}

/// Test-only hooks for the integration suite; not part of the FFI surface.
#[doc(hidden)]
pub mod testing {
    pub use crate::ui::{account_avatar, passphrase_strength};

    /// Opens a raw envelope JSON string, as the extension would.
    pub fn open_envelope(
        json: &str,
        password: &str,
        scope: &str,
    ) -> Result<Vec<u8>, crate::CoreError> {
        let envelope: crate::vault::Envelope =
            serde_json::from_str(json).map_err(|_| crate::CoreError::Storage {
                reason: "not an envelope".into(),
            })?;
        crate::vault::open(&envelope, password, scope).map(|(plaintext, _)| plaintext.to_vec())
    }
}
