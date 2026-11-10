//! The vault envelope, from `wallet_core::envelope`: byte-compatible with the extension's
//! `EncryptedEnvelope` v3 (PBKDF2-SHA-256 into AES-256-GCM). What stays here is Bramble's
//! passphrase rule. The shared core's `SealingKey::create` takes any passphrase, so every path
//! that makes a vault calls `check_password` first.

use crate::CoreError;

pub use wallet_core::envelope::{open, random, Envelope, SealingKey, KDF_ITERATIONS};

/// Shortest vault password, as `MIN_VAULT_PASSPHRASE_LENGTH` (the rule itself is `ui::is_vault_passphrase`).
pub const MIN_PASSWORD_LENGTH: usize = 8;

/// Checks the password bounds the extension's setup screen enforces.
pub fn check_password(password: &str) -> Result<(), CoreError> {
    if !crate::ui::is_vault_passphrase(password) {
        return Err(CoreError::InvalidInput {
            reason: format!("password must be at least {MIN_PASSWORD_LENGTH} characters"),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enforces_password_bounds() {
        assert!(check_password("short").is_err());
        assert!(check_password("        x").is_err());
        assert!(check_password("long enough").is_ok());
    }
}
