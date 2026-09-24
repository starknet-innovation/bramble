//! `WalletCore`: the one object the native apps hold. It owns the recovery phrase for the length
//! of an unlocked session and never hands key material across the FFI boundary. The phrase
//! leaves the core in exactly two places, both for the user to write down: once at creation,
//! and on an explicit reveal that re-checks the password.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use zeroize::Zeroizing;

use crate::account_catalog::AccountFamily;
use crate::account_store::{self, VaultPayload};
use crate::networks::NetworkId;
use crate::recovery_scan::ScanState;
use crate::vault::{self, Envelope, SealingKey};
use crate::{kms, CoreError};

pub(crate) const VAULT_FILE: &str = "vault.json";
// The scope names the envelope's purpose; the payload's own `version` carries its schema
// (`account_store.rs`).
pub(crate) const VAULT_SCOPE: &str = "bramble.mobile.vault.v1";

pub(crate) struct Session {
    pub(crate) payload: VaultPayload,
    sealing_key: SealingKey,
    /// The discovery scan, never persisted; dropped with the session on lock.
    pub(crate) scan: Option<ScanState>,
}

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

/// Key custody and vault lifecycle. Thread-safe; every method takes `&self`.
#[derive(uniffi::Object)]
pub struct WalletCore {
    data_dir: PathBuf,
    session: Mutex<Option<Session>>,
}

fn storage(reason: &str) -> CoreError {
    CoreError::Storage {
        reason: reason.into(),
    }
}

impl WalletCore {
    fn vault_path(&self) -> PathBuf {
        self.data_dir.join(VAULT_FILE)
    }

    fn lock_session(&self) -> MutexGuard<'_, Option<Session>> {
        // A poisoned lock means a panic mid-operation; clearing the session fails closed.
        self.session.lock().unwrap_or_else(|poisoned| {
            let mut guard = poisoned.into_inner();
            *guard = None;
            guard
        })
    }

    fn read_envelope(&self) -> Result<Envelope, CoreError> {
        let text = fs::read_to_string(self.vault_path()).map_err(|_| CoreError::NoWallet)?;
        serde_json::from_str(&text).map_err(|_| storage("vault file is not an envelope"))
    }

    pub(crate) fn write_session(&self, session: &Session) -> Result<(), CoreError> {
        account_store::check_consistent(&session.payload)?;
        let plaintext = Zeroizing::new(
            serde_json::to_vec(&session.payload).map_err(|_| storage("serialise vault"))?,
        );
        let envelope = session.sealing_key.seal(&plaintext, VAULT_SCOPE)?;
        let body = serde_json::to_vec(&envelope).map_err(|_| storage("serialise envelope"))?;
        // Write-then-rename so an interrupted write never leaves a truncated vault.
        let temporary = self.data_dir.join(format!("{VAULT_FILE}.tmp"));
        let mut file = fs::File::create(&temporary).map_err(|_| storage("create vault"))?;
        file.write_all(&body)
            .and_then(|()| file.sync_all())
            .map_err(|_| storage("write vault"))?;
        fs::rename(&temporary, self.vault_path()).map_err(|_| storage("commit vault"))
    }

    /// Opens and validates the vault; `true` when the payload was migrated and must be re-sealed.
    fn open_session(&self, password: &str) -> Result<(Session, bool), CoreError> {
        let envelope = self.read_envelope()?;
        let (plaintext, sealing_key) = vault::open(&envelope, password, VAULT_SCOPE)?;
        let (payload, migrated) = account_store::open(&plaintext)?;
        Ok((
            Session {
                payload,
                sealing_key,
                scan: None,
            },
            migrated,
        ))
    }

    pub(crate) fn with_session<T>(
        &self,
        f: impl FnOnce(&mut Session) -> Result<T, CoreError>,
    ) -> Result<T, CoreError> {
        let mut guard = self.lock_session();
        match guard.as_mut() {
            Some(session) => f(session),
            None if self.vault_path().exists() => Err(CoreError::Locked),
            None => Err(CoreError::NoWallet),
        }
    }

    /// Writes a new vault: OZ index 0 on `first_account` for a created wallet, or no accounts
    /// and `recoveryPending` for an imported one, which discovery then fills.
    pub(crate) fn install(
        &self,
        password: &str,
        mnemonic: Zeroizing<String>,
        passphrase: Option<String>,
        first_account: Option<NetworkId>,
    ) -> Result<(), CoreError> {
        let mut guard = self.lock_session();
        if self.vault_path().exists() {
            return Err(CoreError::WalletExists);
        }
        let session = Session {
            payload: VaultPayload::new(mnemonic.to_string(), passphrase, first_account)?,
            sealing_key: SealingKey::create(password)?,
            scan: None,
        };
        self.write_session(&session)?;
        *guard = Some(session);
        Ok(())
    }
}

#[uniffi::export]
impl WalletCore {
    /// Opens the core over an app-private directory. The host chooses a directory excluded from
    /// backups and protected at rest (iOS complete file protection; Android `noBackupFilesDir`).
    #[uniffi::constructor]
    pub fn new(data_dir: String) -> Result<Arc<Self>, CoreError> {
        let data_dir = PathBuf::from(data_dir);
        fs::create_dir_all(&data_dir).map_err(|_| storage("data directory is not writable"))?;
        Ok(Arc::new(Self {
            data_dir,
            session: Mutex::new(None),
        }))
    }

    /// Current lifecycle state.
    pub fn status(&self) -> WalletStatus {
        match (self.lock_session().is_some(), self.vault_path().exists()) {
            (true, _) => WalletStatus::Unlocked,
            (false, true) => WalletStatus::Locked,
            (false, false) => WalletStatus::NoWallet,
        }
    }

    /// Creates a wallet from fresh entropy with its first account on Mainnet (the extension's
    /// default network) and leaves it unlocked. Hosts that know the selected network call
    /// `create_wallet_on_network`. The returned phrase is the only copy the UI ever receives
    /// unprompted; it must be shown once for backup and dropped.
    pub fn create_wallet(
        &self,
        password: String,
        word_count: u8,
    ) -> Result<RecoveryPhrase, CoreError> {
        self.create_wallet_on_network(password, word_count, NetworkId::Mainnet)
    }

    /// Imports an existing phrase (and optional BIP-39 passphrase) and leaves the wallet unlocked
    /// with no accounts yet: `recovery_pending` is set until discovery restores the user's
    /// selection (`restore_recovered_accounts`).
    pub fn import_wallet(
        &self,
        password: String,
        phrase: String,
        passphrase: Option<String>,
    ) -> Result<(), CoreError> {
        vault::check_password(&password)?;
        let mnemonic = kms::normalise_phrase(&Zeroizing::new(phrase));
        if !kms::validate_mnemonic(&mnemonic) {
            return Err(CoreError::InvalidInput {
                reason: "invalid recovery phrase".into(),
            });
        }
        self.install(
            &password,
            mnemonic,
            passphrase.filter(|p| !p.is_empty()),
            None,
        )
    }

    /// Decrypts the vault into memory. A version-1 vault is migrated and re-sealed before this
    /// returns, so an older build then refuses it rather than misreading it.
    pub fn unlock(&self, password: String) -> Result<(), CoreError> {
        let (session, migrated) = self.open_session(&password)?;
        if migrated {
            self.write_session(&session)?;
        }
        *self.lock_session() = Some(session);
        Ok(())
    }

    /// Wipes the session; the phrase and vault key are zeroized as they drop.
    pub fn lock(&self) {
        *self.lock_session() = None;
    }

    /// Deprecated shim (`docs/accounts.md` §3.1): the **OpenZeppelin** records on `network`, as
    /// `AccountInfo` with `index = account_index`. Argent and Braavos records are never returned
    /// here, so no caller can mistake one for OZ. Use `account_records`. Empty while recovery is
    /// pending.
    pub fn accounts(&self, network: NetworkId) -> Result<Vec<AccountInfo>, CoreError> {
        self.with_session(|session| {
            Ok(session
                .payload
                .accounts
                .iter()
                .filter(|record| {
                    record.network() == network && record.family() == AccountFamily::OpenZeppelin
                })
                .map(|record| AccountInfo {
                    index: record.account_index,
                    address: record.address.clone(),
                    public_key: record.public_key.clone(),
                    class_hash: record.class_hash.clone(),
                    network,
                })
                .collect())
        })
    }

    /// Deprecated alias of `add_regular_account`, returning `AccountInfo`.
    pub fn add_account(&self, network: NetworkId) -> Result<AccountInfo, CoreError> {
        let record = self.add_regular_account(network)?;
        Ok(AccountInfo {
            index: record.account_index,
            address: record.address,
            public_key: record.public_key,
            class_hash: record.class_hash,
            network,
        })
    }

    /// Deprecated shim: signs with the key at `account_index` only when an **OpenZeppelin**
    /// record exists at that index (either network), no view-only (Braavos) record shares the
    /// index, and recovery is not pending. Every family at one index shares that key, so a
    /// view-only record at the index would otherwise be signable through this path; see
    /// `docs/accounts.md` §2.7. Use `sign_hash_for_account`.
    pub fn sign_hash(
        &self,
        account_index: u32,
        message_hash: String,
    ) -> Result<StarkSignature, CoreError> {
        self.with_session(|session| {
            let signable = !session.payload.recovery_pending
                && session.payload.accounts.iter().any(|record| {
                    record.account_index == account_index
                        && record.family() == AccountFamily::OpenZeppelin
                })
                && !session
                    .payload
                    .accounts
                    .iter()
                    .any(|record| record.account_index == account_index && record.view_only());
            if !signable {
                return Err(CoreError::InvalidInput {
                    reason: "unknown account".into(),
                });
            }
            let signature = kms::sign_hash(
                &session.payload.mnemonic,
                session.payload.mnemonic_passphrase.as_deref(),
                account_index,
                &message_hash,
            )?;
            Ok(StarkSignature {
                public_key: signature.public_key,
                r: signature.r,
                s: signature.s,
            })
        })
    }

    /// Re-checks the password against the vault on disk, then returns the phrase for display.
    pub fn reveal_recovery_phrase(&self, password: String) -> Result<RecoveryPhrase, CoreError> {
        let (session, _) = self.open_session(&password)?;
        Ok(RecoveryPhrase {
            words: session
                .payload
                .mnemonic
                .split(' ')
                .map(str::to_string)
                .collect(),
        })
    }

    /// Deletes the vault after re-checking the password. Irreversible without the phrase.
    pub fn delete_wallet(&self, password: String) -> Result<(), CoreError> {
        drop(self.open_session(&password)?);
        let mut guard = self.lock_session();
        fs::remove_file(self.vault_path()).map_err(|_| storage("remove vault"))?;
        *guard = None;
        Ok(())
    }
}
