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
mod activity;
mod argent_multisig;
mod backup;
mod biometric;
mod class_declared;
mod clock;
mod contact_card;
mod contacts;
mod container;
mod coordination;
mod felt;
mod ffi_coordination;
mod ffi_nostr_multisig;
mod files;
mod groups;
mod history;
mod js;
mod kms;
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
mod recovery_scan;
mod rpc;
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
pub use rpc::{RpcRequest, RpcResponse};
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
pub use ui::{AccountAvatar, PassphraseLevel, PassphraseStrength};
pub use wallet::{
    AccountInfo, RecoveryPhrase, SecurityStatus, StarkSignature, WalletCore, WalletStatus,
};
pub use wallet_accounts::AccountRecord;

// Portfolio and activity (mobile/docs/portfolio-activity.md).
pub use history::activity::{ActivityEntry, FailureNotice};
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

/// Test-only hooks for the integration suite; not part of the FFI surface. Compiled only for
/// unit tests or with the `testing` feature, so shipped libraries carry no raw vault access.
#[cfg(any(test, feature = "testing"))]
#[doc(hidden)]
pub mod testing {
    pub use crate::privacy::testing as privacy;
    pub use crate::security::{delay_ms, BASE_DELAY_MS, FREE_ATTEMPTS, MAX_DELAY_MS};
    pub use crate::ui::{account_avatar, passphrase_strength};
    pub use crate::vault::{KDF_ITERATIONS, MIN_PASSWORD_LENGTH};
    pub use crate::wallet::IDLE_LOCK_MS;

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

    /// Opens a DEK passphrase slot (scope `bramble.mobile.dek.v1`) exactly as the vault does.
    pub fn open_password_slot(json: &str, password: &str) -> Result<Vec<u8>, crate::CoreError> {
        let envelope: crate::vault::Envelope =
            serde_json::from_str(json).map_err(|_| crate::CoreError::Storage {
                reason: "not an envelope".into(),
            })?;
        let (plaintext, _) = crate::vault::open(&envelope, password, crate::container::DEK_SCOPE)?;
        crate::container::decode_dek(&plaintext).map(|dek| dek.to_vec())
    }

    /// Seals `plaintext` as a pre-container vault in `dir`: a bare envelope with scope
    /// `bramble.mobile.vault.v1`, as the original core (payload version 1) and the accounts branch
    /// before the merge (records payload, version 2) wrote it.
    pub fn seal_envelope_vault(
        dir: &str,
        password: &str,
        plaintext: &str,
    ) -> Result<(), crate::CoreError> {
        let key = crate::vault::SealingKey::create(password)?;
        let envelope = key.seal_with(
            plaintext.as_bytes(),
            crate::container::V1_SCOPE,
            &crate::vault::random::<12>()?,
            &crate::vault::random::<16>()?,
        )?;
        write_vault(
            dir,
            &serde_json::to_vec(&envelope).expect("envelope serialises"),
        )
    }

    /// Seals `plaintext` into a DEK container of `version` in `dir`, as vault-security (version 2)
    /// or this core (version 3) writes it.
    pub fn seal_container_vault(
        dir: &str,
        password: &str,
        version: u32,
        plaintext: &str,
    ) -> Result<(), crate::CoreError> {
        let key = crate::vault::SealingKey::create(password)?;
        let dek = crate::container::new_dek()?;
        let randomness = crate::container::Randomness::draw()?;
        let file = crate::container::seal_new(&key, &dek, plaintext.as_bytes(), &randomness)?;
        let file = crate::container::VaultFile { version, ..file };
        write_vault(
            dir,
            &serde_json::to_vec(&file).expect("container serialises"),
        )
    }

    fn write_vault(dir: &str, body: &[u8]) -> Result<(), crate::CoreError> {
        let path = std::path::Path::new(dir).join(crate::wallet::VAULT_FILE);
        std::fs::write(path, body).map_err(|_| crate::CoreError::Storage {
            reason: "write vault".into(),
        })
    }

    /// Opens the wallet vault in `dir` (a current or older container) with the passphrase and
    /// returns its decrypted payload JSON as stored, without migrating it.
    pub fn open_vault(dir: &str, password: &str) -> Result<String, crate::CoreError> {
        let path = std::path::Path::new(dir).join(crate::wallet::VAULT_FILE);
        let json = std::fs::read_to_string(path).map_err(|_| crate::CoreError::NoWallet)?;
        let plaintext = match crate::container::parse(&json)? {
            crate::container::StoredVault::Container(file) => {
                let (dek, _) = file.open_dek(password)?;
                file.open_payload(&dek)?
            }
            crate::container::StoredVault::Envelope(envelope) => {
                crate::vault::open(&envelope, password, crate::container::V1_SCOPE)?.0
            }
        };
        Ok(String::from_utf8(plaintext.to_vec()).expect("payload is UTF-8"))
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

    /// The coordination public key at Nostr address `index`. Parity suites use the published
    /// test phrase's address 1 as the co-signer, so no second phrase appears in the repository.
    pub fn nostr_public_key_at(mnemonic: &str, index: u32) -> Result<String, crate::CoreError> {
        crate::nostr::public_key_at(mnemonic, index)
    }

    /// Opens a gift wrap for the coordination key at Nostr address `index`:
    /// `(content, identifier, sender)`.
    pub fn open_gift_wrap(
        mnemonic: &str,
        index: u32,
        event_json: &str,
    ) -> Option<(String, String, String)> {
        let event = crate::nostr::parse_event_json(event_json)?;
        let opened = crate::nostr::open_at(mnemonic, index, &event)?;
        Some((opened.content, opened.identifier, opened.sender_public_key))
    }

    /// Wraps application data from the coordination key at Nostr address `index`.
    pub fn wrap_gift(
        mnemonic: &str,
        index: u32,
        recipient: &str,
        identifier: &str,
        content: &str,
        now: u64,
    ) -> Result<String, crate::CoreError> {
        crate::nostr::wrap(mnemonic, index, recipient, identifier, content, now)
    }
}
