//! Plain records the FFI hands to the apps. None carries a secret except `RecoveryPhrase`,
//! which only the creation and passphrase-rechecked reveal paths ever build.

use crate::networks::NetworkId;

/// Where the wallet is in its lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum WalletStatus {
    NoWallet,
    Locked,
    Unlocked,
}

/// A recovery phrase handed to the UI for backup display only.
#[derive(uniffi::Record)]
pub struct RecoveryPhrase {
    pub words: Vec<String>,
}

/// Public account metadata; safe to render and log.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AccountInfo {
    pub index: u32,
    pub address: String,
    pub public_key: String,
    pub class_hash: String,
    pub network: NetworkId,
}

/// A Stark signature record.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct StarkSignature {
    pub public_key: String,
    pub r: String,
    pub s: String,
}

/// Lock and backoff state for the Security screen. Carries no secret and no vault bytes.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct SecurityStatus {
    pub biometric_enabled: bool,
    /// 0 when a passphrase attempt is allowed now.
    pub retry_after_ms: u64,
    pub failed_attempts: u32,
    pub idle_lock_ms: u64,
    /// Time left before the idle lock; `None` while locked.
    pub session_remaining_ms: Option<u64>,
}
