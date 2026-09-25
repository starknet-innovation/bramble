//! The backup-pending flag (vault version 4): the create flow writes the vault before the user
//! has confirmed their backup, so the vault records that the Confirm backup step is still owed.
//! It is set when a wallet is created (`VaultPayload::new`), survives lock and restart, and is
//! cleared only by `confirm_backup`. It is not secret: it says nothing about the phrase, and the
//! words themselves are only ever revealed through the password-checked
//! `reveal_recovery_phrase`.

use crate::wallet::WalletCore;
use crate::CoreError;

#[uniffi::export]
impl WalletCore {
    /// Whether this wallet was created here and its backup has not been confirmed yet. Hosts read
    /// it after every unlock and, while it holds, route back to Save phrase → Confirm backup
    /// instead of into the wallet. Passive: never renews the idle window. `Locked` / `NoWallet`
    /// without a session.
    pub fn backup_pending(&self) -> Result<bool, CoreError> {
        self.with_session(false, |session| {
            Ok(session.payload.backup_pending == Some(true))
        })
    }

    /// Records that the Confirm backup step succeeded: clears the flag and re-seals the vault.
    /// Idempotent (no write when already clear). A failed write leaves the flag set in memory and
    /// on disk, so the step is offered again. Renews the idle window.
    pub fn confirm_backup(&self) -> Result<(), CoreError> {
        self.with_session(true, |session| {
            if session.payload.backup_pending != Some(true) {
                return Ok(());
            }
            self.commit(session, |payload| {
                payload.backup_pending = Some(false);
                Ok(())
            })
        })
    }
}
