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

mod activity;
mod felt;
mod kms;
mod networks;
mod privacy;
mod rpc;
mod send;
mod ui;
mod vault;
mod wallet;

pub use networks::{NetworkId, NetworkInfo, TokenInfo};
pub use privacy::plan::PrivacyReadPlan;
pub use privacy::types::{
    DetailAction, DetailSummary, PoolNotice, PrivacyBlocker, PrivacyCapabilities, PrivacyEntry,
    PrivacyError, PrivacyFailure, PrivacyPurpose, PrivacyReading, PrivacyRegistration,
    PrivacyReply, PrivacyState, PrivacyStatus, PrivacyStep, PrivateBalance, PrivateLine,
    PublicBalance, ShieldTile, TokenDetailPrivacy, UnifiedBalance,
};
pub use privacy::{
    max_privacy_response_bytes, privacy_capabilities, privacy_configured, privacy_discovery_url,
    privacy_entry, privacy_status, private_line, receive_pool_notice,
    set_privacy_discovery_override, shield_tile, shielded_balances_included, token_detail_privacy,
    unified_home_balances,
};
pub use send::plan::TransferPlan;
pub use send::types::{
    ActivityKind, ActivityRecord, DeploymentState, FeeAffordability, FeeAmount, FeeUnit,
    ReviewFlag, RpcPurpose, SendAmountError, SendError, SendFailure, SendFailureCode, SendStep,
    StepReply, TransferRequest, TransferReview, TxStatus,
};
pub use send::{
    confirmation_checkpoints_ms, deployment_status_request, explorer_transaction_url,
    judge_deployment_status, parse_token_amount, short_address, validate_recipient,
};
pub use ui::{AccountAvatar, PassphraseLevel, PassphraseStrength};
pub use wallet::{AccountInfo, RecoveryPhrase, StarkSignature, WalletCore, WalletStatus};

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

/// Public explorer page for an account, as the extension's `explorerAccountUrl`; `None` when the
/// address is not a well-formed non-zero felt, so no caller can build a link that cannot resolve.
#[uniffi::export]
pub fn explorer_account_url(network: NetworkId, address: String) -> Option<String> {
    let address = felt::parse_non_zero(&address)?;
    Some(format!(
        "{}/contract/{}",
        networks::info(network).explorer_base_url,
        felt::canonical(&address)
    ))
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
            Some("https://starkscan.co/contract/0xab")
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
    pub use crate::privacy::testing as privacy;
    pub use crate::ui::{account_avatar, passphrase_strength};

    /// The scoped STRK20 viewing key the core derives for an account, for the extension-parity
    /// suite only (fixture keys come from the published parity phrase and are public).
    pub fn strk20_viewing_key(
        mnemonic: &str,
        account_index: u32,
        chain_id: &str,
        pool_address: &str,
    ) -> Result<String, crate::CoreError> {
        crate::kms::derive_scoped_viewing_key(mnemonic, None, account_index, chain_id, pool_address)
            .map(|key| crate::felt::canonical(&key))
    }

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
