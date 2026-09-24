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

mod account_catalog;
mod account_names;
mod account_store;
mod felt;
mod groups;
mod kms;
mod kms_accounts;
mod networks;
mod recovery;
mod recovery_scan;
mod rpc;
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
pub use groups::AccountGroup;
pub use networks::{NetworkId, NetworkInfo, TokenInfo};
pub use recovery::{RecoveryCandidate, RecoverySelection};
pub use recovery_scan::{RecoveryScanStep, RpcRequest, RpcResponse};
pub use ui::{AccountAvatar, PassphraseLevel, PassphraseStrength};
pub use wallet::{AccountInfo, RecoveryPhrase, StarkSignature, WalletCore, WalletStatus};
pub use wallet_accounts::AccountRecord;

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

/// Test-only hooks for the integration suite; not part of the FFI surface. Compiled only for
/// unit tests or with the `testing` feature, so shipped libraries carry no raw vault access.
#[cfg(any(test, feature = "testing"))]
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

    /// Seals `plaintext` as a wallet vault in `dir`, as a build with that payload would have.
    pub fn seal_vault(dir: &str, password: &str, plaintext: &str) -> Result<(), crate::CoreError> {
        let key = crate::vault::SealingKey::create(password)?;
        let envelope = key.seal(plaintext.as_bytes(), crate::wallet::VAULT_SCOPE)?;
        let path = std::path::Path::new(dir).join(crate::wallet::VAULT_FILE);
        std::fs::write(
            path,
            serde_json::to_vec(&envelope).expect("envelope serialises"),
        )
        .map_err(|_| crate::CoreError::Storage {
            reason: "write vault".into(),
        })
    }

    /// Opens the wallet vault in `dir` and returns its plaintext payload.
    pub fn open_vault(dir: &str, password: &str) -> Result<String, crate::CoreError> {
        let path = std::path::Path::new(dir).join(crate::wallet::VAULT_FILE);
        let json = std::fs::read_to_string(path).map_err(|_| crate::CoreError::NoWallet)?;
        let plaintext = open_envelope(&json, password, crate::wallet::VAULT_SCOPE)?;
        Ok(String::from_utf8(plaintext).expect("payload is UTF-8"))
    }

    /// Words one discovery row exactly as the scan would.
    pub fn recovery_candidate(
        family: crate::AccountFamily,
        class_hash: &str,
        account_index: u32,
        address: &str,
        deployed: bool,
        funded: bool,
    ) -> crate::RecoveryCandidate {
        crate::recovery::candidate(&crate::recovery::Found {
            family,
            class_hash: crate::felt::parse(class_hash).expect("class hash is a felt"),
            account_index,
            address: crate::felt::parse(address).expect("address is a felt"),
            deployed,
            funded,
        })
    }
}
