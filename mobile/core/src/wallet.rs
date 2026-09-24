//! `WalletCore`: the one object the native apps hold. It owns the recovery phrase for the length
//! of an unlocked session and never hands key material across the FFI boundary. The phrase
//! leaves the core in exactly two places, both for the user to write down: once at creation,
//! and on an explicit reveal that re-checks the password.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::networks::NetworkId;
use crate::vault::{self, Envelope, SealingKey};
use crate::{kms, CoreError};

const VAULT_FILE: &str = "vault.json";
const VAULT_SCOPE: &str = "bramble.mobile.vault.v1";
/// Accounts one phrase may hold; bounds derivation work and vault size.
const MAX_ACCOUNTS: u32 = 32;

/// Plaintext sealed inside the vault envelope.
#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultPayload {
    account_count: u32,
    mnemonic: String,
    mnemonic_passphrase: Option<String>,
    version: u32,
}

struct Session {
    payload: VaultPayload,
    sealing_key: SealingKey,
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

    fn write_session(&self, session: &Session) -> Result<(), CoreError> {
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

    fn open_session(&self, password: &str) -> Result<Session, CoreError> {
        let envelope = self.read_envelope()?;
        let (plaintext, sealing_key) = vault::open(&envelope, password, VAULT_SCOPE)?;
        let payload: VaultPayload =
            serde_json::from_slice(&plaintext).map_err(|_| storage("vault payload is invalid"))?;
        if payload.version != 1
            || payload.account_count == 0
            || payload.account_count > MAX_ACCOUNTS
            || !kms::validate_mnemonic(&payload.mnemonic)
        {
            return Err(storage("vault payload is invalid"));
        }
        Ok(Session {
            payload,
            sealing_key,
        })
    }

    fn with_session<T>(
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

    fn account(
        session: &Session,
        index: u32,
        network: NetworkId,
    ) -> Result<AccountInfo, CoreError> {
        let derived = kms::derive_account(
            &session.payload.mnemonic,
            session.payload.mnemonic_passphrase.as_deref(),
            index,
            network.chain(),
        )?;
        Ok(AccountInfo {
            index,
            address: derived.address,
            public_key: derived.public_key,
            class_hash: derived.class_hash,
            network,
        })
    }

    fn install(
        &self,
        password: &str,
        mnemonic: Zeroizing<String>,
        passphrase: Option<String>,
    ) -> Result<(), CoreError> {
        let mut guard = self.lock_session();
        if self.vault_path().exists() {
            return Err(CoreError::WalletExists);
        }
        let session = Session {
            payload: VaultPayload {
                account_count: 1,
                mnemonic: mnemonic.to_string(),
                mnemonic_passphrase: passphrase,
                version: 1,
            },
            sealing_key: SealingKey::create(password)?,
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

    /// Creates a wallet from fresh entropy and leaves it unlocked. The returned phrase is the
    /// only copy the UI ever receives unprompted; it must be shown once for backup and dropped.
    pub fn create_wallet(
        &self,
        password: String,
        word_count: u8,
    ) -> Result<RecoveryPhrase, CoreError> {
        vault::check_password(&password)?;
        let mnemonic = kms::generate_mnemonic(word_count)?;
        let words = mnemonic.split(' ').map(str::to_string).collect();
        self.install(&password, mnemonic, None)?;
        Ok(RecoveryPhrase { words })
    }

    /// Imports an existing phrase (and optional BIP-39 passphrase) and leaves the wallet unlocked.
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
        self.install(&password, mnemonic, passphrase.filter(|p| !p.is_empty()))
    }

    /// Decrypts the vault into memory.
    pub fn unlock(&self, password: String) -> Result<(), CoreError> {
        let session = self.open_session(&password)?;
        *self.lock_session() = Some(session);
        Ok(())
    }

    /// Wipes the session; the phrase and vault key are zeroized as they drop.
    pub fn lock(&self) {
        *self.lock_session() = None;
    }

    /// Every account on `network`.
    pub fn accounts(&self, network: NetworkId) -> Result<Vec<AccountInfo>, CoreError> {
        self.with_session(|session| {
            (0..session.payload.account_count)
                .map(|index| Self::account(session, index, network))
                .collect()
        })
    }

    /// Derives the next account and persists the new count.
    pub fn add_account(&self, network: NetworkId) -> Result<AccountInfo, CoreError> {
        self.with_session(|session| {
            let index = session.payload.account_count;
            if index >= MAX_ACCOUNTS {
                return Err(CoreError::InvalidInput {
                    reason: "account limit reached".into(),
                });
            }
            let account = Self::account(session, index, network)?;
            session.payload.account_count += 1;
            if let Err(error) = self.write_session(session) {
                session.payload.account_count -= 1;
                return Err(error);
            }
            Ok(account)
        })
    }

    /// Signs a transaction or message hash for one account. The host computes the hash from the
    /// reviewed request; the key is derived, used, and wiped inside this call.
    pub fn sign_hash(
        &self,
        account_index: u32,
        message_hash: String,
    ) -> Result<StarkSignature, CoreError> {
        self.with_session(|session| {
            if account_index >= session.payload.account_count {
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
        let session = self.open_session(&password)?;
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
