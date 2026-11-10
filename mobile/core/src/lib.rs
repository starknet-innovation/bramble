//! Bramble mobile core.
//!
//! The Rust middleware shared by the iOS and Android wallets. It is the mobile counterpart of the
//! extension's background service: Krusty KMS key custody (`kms`), the encrypted vault
//! (`vault`, byte-compatible with the extension envelope), the bundled network catalog
//! (`networks`), and sans-IO Starknet RPC (`wallet_core::rpc`). The native apps render UI and move bytes;
//! they never see a private key.
//!
//! Errors carry an operation name or a fixed reason, never input text, so nothing a user typed
//! can reach a log through an error message.

mod account_catalog;
mod account_names;
mod account_store;
mod activity;
mod argent_multisig;
mod avatar;
mod backup;
mod biometric;
mod class_declared;
mod clock;
mod contact_card;
mod contacts;
mod container;
mod coordination;
pub(crate) use wallet_core::felt;
mod ffi_coordination;
mod ffi_nostr_multisig;
mod files;
mod groups;
mod history;
mod js;
mod kms;
pub use kms::Ladder;
mod kms_accounts;
mod migrations;
mod multisig_constants;
mod multisig_rpc;
mod multisig_store;
mod networks;
mod nostr;
mod nostr_relay;
mod portfolio;
#[doc(hidden)]
pub mod portfolio_testing;
mod privacy;
mod public_store;
mod records;
mod recovery;
mod recovery_advisory;
mod recovery_scan;
pub(crate) use wallet_core::rpc;
mod rpc_request;
mod security;
mod send;
mod ui;
mod vault;
mod wallet;
mod wallet_accounts;

pub use account_catalog::{
    account_classes, account_family_name, copy_feedback, group_icons, recovery_limits,
    AccountClassInfo, AccountFamily, CopyFeedback, RecoveryLimits,
};
pub use account_names::{
    account_display_name, account_label, account_preview_label, friendly_account_name,
    is_account_label,
};
pub use argent_multisig::{ArgentMultisigConfig, ArgentMultisigPrediction};
pub use avatar::{AccountAvatar, AvatarPaint, AvatarPart, AvatarShape};
pub use biometric::BiometricDomain;
pub use class_declared::ClassDeclaredRead;
pub use clock::HostClock;
pub use contact_card::{ContactCardParse, WalletContactCard};
pub use contacts::Contact;
pub use ffi_coordination::{CoordinationSyncOutcome, NostrSyncPlan, RelayPolicy};
pub use ffi_nostr_multisig::{
    argent_multisig_normalize, argent_multisig_predict, argent_signer_guid, multisig_limits,
    nostr_relay_url_normalize, wallet_contact_card_encode, wallet_contact_card_parse,
    MultisigLimits, MultisigRecord,
};
pub use groups::AccountGroup;
pub use multisig_rpc::{MultisigAuthorityRead, MultisigAuthorityStatus};
pub use networks::{NetworkId, NetworkInfo, TokenInfo};
pub use nostr_relay::RelayStep;
pub use privacy::plan::PrivacyReadPlan;
pub use privacy::types::{
    DetailAction, DetailSummary, PoolNotice, PrivacyBlocker, PrivacyCapabilities, PrivacyEntry,
    PrivacyError, PrivacyFailure, PrivacyPurpose, PrivacyReading, PrivacyRegistration,
    PrivacyReply, PrivacyState, PrivacyStatus, PrivacyStep, PrivateBalance, PrivateLine,
    ShieldTile, TokenDetailPrivacy, UnifiedBalance,
};
pub use privacy::{
    max_privacy_response_bytes, privacy_capabilities, privacy_configured, privacy_discovery_url,
    privacy_entry, privacy_status, private_line, receive_pool_notice,
    set_privacy_discovery_override, shield_tile, shielded_balances_included, token_detail_privacy,
    unified_home_balances,
};
pub use recovery::{RecoveryCandidate, RecoverySelection};
pub use recovery_scan::RecoveryScanStep;
pub use rpc_request::{RpcRequest, RpcResponse};
pub use send::plan::TransferPlan;
pub use send::types::{
    ActivityKind, DeploymentState, FeeAffordability, FeeAmount, FeeUnit, ReviewFlag, RpcPurpose,
    SendAmountError, SendError, SendFailure, SendFailureCode, SendStep, StepReply, TransferRequest,
    TransferReview, TxStatus,
};
pub use send::{
    activity_needs_observation, activity_observation_period_for, activity_observation_period_ms,
    confirmation_checkpoints_ms, deployment_status_request, judge_deployment_status,
    parse_token_amount, validate_recipient,
};
pub use ui::{PassphraseLevel, PassphraseStrength};
pub use wallet::{
    AccountInfo, RecoveryPhrase, SecurityStatus, StarkSignature, WalletCore, WalletStatus,
};
pub use wallet_accounts::AccountRecord;

// Portfolio and activity (mobile/docs/portfolio-activity.md).
pub use history::activity::{ActivityEntry, FailureNotice, TransferDirection};
pub use history::activity_book::{ActivityBook, ActivityView};
pub use history::appearance::{
    activity_empty_copy, activity_groups, activity_unavailable_notice, ActivityCounterparty,
    ActivityDayGroup, ActivityDirection, ActivityRow, ActivityTone,
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
    rpc_limits, HttpHeader, HttpMethod, HttpOutcome, HttpRequest, RpcLimits, RpcReply,
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
    /// Too many wrong passphrases: no attempt is allowed for `retry_after_ms`.
    #[error("too many attempts; retry in {retry_after_ms} ms")]
    Throttled { retry_after_ms: u64 },
    /// Biometric unlock is not set up (no slot, or the vault predates it).
    #[error("biometric unlock is not enabled")]
    BiometricUnavailable,
    /// Enrolment changed or the slot no longer opens; the slot has been removed.
    #[error("biometric unlock was invalidated")]
    BiometricInvalidated,
    /// Nostr coordination failed; `reason` is a fixed operation name, never input text.
    #[error("coordination failure: {reason}")]
    Coordination { reason: String },
}

impl From<wallet_core::Error> for CoreError {
    fn from(error: wallet_core::Error) -> Self {
        match error {
            wallet_core::Error::InvalidInput { reason } => Self::InvalidInput { reason },
            wallet_core::Error::Kms { operation } => Self::Kms { operation },
            wallet_core::Error::WrongPassword => Self::WrongPassword,
            wallet_core::Error::Storage { reason } => Self::Storage { reason },
            wallet_core::Error::BiometricUnavailable => Self::BiometricUnavailable,
            wallet_core::Error::BiometricInvalidated => Self::BiometricInvalidated,
            wallet_core::Error::Rpc { reason } => Self::Rpc { reason },
        }
    }
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
        krusty_version: wallet_core::KRUSTY_VERSION.into(),
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
    Ok(rpc::verify_chain_id(&body, id, network.core())?)
}

/// JSON-RPC body for an ERC-20 balance query.
#[uniffi::export]
pub fn rpc_balance_request(id: u64, token: String, account: String) -> Result<String, CoreError> {
    Ok(rpc::balance_of_request(id, &token, &account)?)
}

/// Base-10 base-unit balance from a balance response.
#[uniffi::export]
pub fn rpc_parse_balance(body: String, id: u64) -> Result<String, CoreError> {
    Ok(rpc::parse_balance_of(&body, id)?)
}

/// The account bird for an address: tones, facing and parts, as the extension's `accountAvatar`.
#[uniffi::export]
pub fn account_avatar(address: String) -> AccountAvatar {
    avatar::account_avatar(&address)
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
    Ok(rpc::format_amount(&raw, decimals, max_fraction)?)
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

/// Test-only hooks for the integration suite; not part of the FFI surface. Compiled only for
/// unit tests or with the `testing` feature, so shipped libraries carry no raw vault access.
#[cfg(any(test, feature = "testing"))]
#[doc(hidden)]
pub mod testing;
